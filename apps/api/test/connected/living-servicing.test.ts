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
import { ACME, AMINA, BETA, browser, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

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

describe("authorization of claim and policy-change mutations (0085, D-164)", () => {
  let claimId = "";
  let docId = "";
  let endorsementId = "";
  let claimWork = "";
  beforeAll(async () => {
    const r = await call(KAMAU, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-3), incidentSummary: `Authorization test ${TAG}.`, policyId, source: "ask" });
    // 201 when new; 200 when the same claim work was reopened.
    expect([200, 201]).toContain(r.status);
    claimWork = r.body.item.id;
    claimId = (await sql`select id from claims where work_item_id = ${claimWork}`)[0]!["id"] as string;
    expect((await call(KAMAU, "POST", `/claims/${claimId}/actions`, { action: "add_document", label: `Logbook ${TAG}`, holder: "client" })).status).toBe(200);
    docId = (await sql`select id from claim_documents where claim_id = ${claimId} and label = ${"Logbook " + TAG}`)[0]!["id"] as string;
    const e = await call(KAMAU, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId, requestText: `Authorization change ${TAG}`, requestedBy: "policyholder" });
    expect([200, 201]).toContain(e.status);
    endorsementId = (await sql`select id from endorsements where work_item_id = ${e.body.item.id}`)[0]!["id"] as string;
    await call(KAMAU, "POST", `/endorsements/${endorsementId}/actions`, { action: "set_details", effectiveOn: day(3), items: [{ id: "a1", label: "KDZ 1", before: null, after: "Add", sumInsuredMinor: 100 }] });
  });

  it("refuses a read-only member every claim mutation through the API, audits it, and records nothing", async () => {
    for (const body of [
      { action: "receive_document", documentId: docId, reference: "Bypass attempt" },
      { action: "add_document", label: "Bypass", holder: "client" },
      { action: "add_call_note", spokeWith: "Client", body: "Bypass" },
      { action: "set_insurer_reference", reference: "BYPASS-1" },
      { action: "set_clock", clauseReference: "Condition 3", clausePage: 4, clauseDays: 7, startEvent: "incident", startOn: day(-3), startEvidence: "Bypass" },
    ]) {
      const r = await call(READER, "POST", `/claims/${claimId}/actions`, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    const [doc] = await sql<{ received_at: string | null }[]>`select received_at from claim_documents where id = ${docId}`;
    expect(doc!.received_at).toBeNull();
    const [c] = await sql<{ insurer_reference: string | null }[]>`select insurer_reference from claims where id = ${claimId}`;
    expect(c!.insurer_reference).toBeNull();
    const denied = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where actor_user_id = ${READER.id} and object_id = ${claimId} and result = 'denied'`;
    expect(denied[0]!.n).toBeGreaterThanOrEqual(5);
  });

  it("refuses a read-only member every policy-change mutation and opening new claim or policy work", async () => {
    for (const body of [
      { action: "decide_item", itemId: "a1", decision: "accepted", responseReference: "Bypass" },
      { action: "record_instruction", reference: "Bypass", from: "policyholder" },
      { action: "set_details", effectiveOn: day(5) },
    ]) expect((await call(READER, "POST", `/endorsements/${endorsementId}/actions`, body)).status, JSON.stringify(body)).toBe(403);
    const [e] = await sql<{ items: { decision: string }[] }[]>`select items from endorsements where id = ${endorsementId}`;
    expect(e!.items[0]!.decision).toBe("pending");
    expect((await call(READER, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-1), incidentSummary: "Bypass", policyId, source: "ask" })).status).toBe(403);
    expect((await call(READER, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId, requestText: "Bypass", requestedBy: "policyholder" })).status).toBe(403);
  });

  it("refuses a read-only member who calls the database functions directly, skipping the API", async () => {
    const direct = await browser(READER, "POST", "rpc/claim_document_receive", { p_document_id: docId, p_reference: "Direct bypass" });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    const decide = await browser(READER, "POST", "rpc/endorsement_item_decide", { p_id: endorsementId, p_item_id: "a1", p_decision: "accepted", p_note: null, p_response_reference: "Direct bypass" });
    expect(decide.status).toBeGreaterThanOrEqual(400);
    const [doc] = await sql<{ received_at: string | null }[]>`select received_at from claim_documents where id = ${docId}`;
    expect(doc!.received_at).toBeNull();
  });

  it("never lets another brokerage change them", async () => {
    expect((await call(BETA, "POST", `/claims/${claimId}/actions`, { action: "receive_document", documentId: docId, reference: "Other brokerage" })).status).toBeGreaterThanOrEqual(403);
    const [doc] = await sql<{ received_at: string | null }[]>`select received_at from claim_documents where id = ${docId}`;
    expect(doc!.received_at).toBeNull();
  });

  it("still lets members with the permission do the same things", async () => {
    expect((await call(KAMAU, "POST", `/claims/${claimId}/actions`, { action: "receive_document", documentId: docId, reference: `Emailed ${TAG}` })).status).toBe(200);
    expect((await call(KAMAU, "POST", `/endorsements/${endorsementId}/actions`, { action: "decide_item", itemId: "a1", decision: "accepted", responseReference: `Jubilee email ${TAG}` })).status).toBe(200);
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "add_call_note", spokeWith: "Client", body: `Called ${TAG}` })).status).toBe(200);
    const [doc] = await sql<{ received_at: string | null }[]>`select received_at from claim_documents where id = ${docId}`;
    expect(doc!.received_at).not.toBeNull();
  });
});

