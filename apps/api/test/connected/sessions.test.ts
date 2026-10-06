/**
 * Named work sessions, Recent and Pins (D-155), connected: real API, real RLS, disposable Postgres.
 * A session is named for what it is for; the same work reopens the same session; its status comes
 * from the Work item it controls; Recent and Pins are personal, per brokerage, and survive anything
 * the browser does; and nothing crosses a brokerage.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp, caller, KAMAU, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const TAG = randomUUID().slice(0, 6);
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
let acmeName = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-sessions')`;
  app = buildApp(API_KEY);
  acmeName = (await sql`select name from clients where id = ${ACME}`)[0]!["name"] as string;
});
afterAll(async () => {
  await sql.end();
});

describe("named sessions", () => {
  let renewalId = "";
  it("a request from Home starts a session named for its purpose and the client it names", async () => {
    const first = acmeName.split(/\s+/)[0]!;
    const r = await call(AMINA, "POST", "/sessions", { text: `Renew ${first}'s motor policy ${TAG}` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.reopened).toBe(false);
    expect(r.body.conversation).toMatchObject({ purpose: "renewal", titleSource: "derived", status: "draft", statusLabel: "Draft", client: { id: ACME } });
    expect(r.body.conversation.title).toMatch(new RegExp(`^Renew ${first}.* motor policy$`));
    renewalId = r.body.conversation.id;
  });

  it("asking for the same thing again reopens that session instead of starting another", async () => {
    const first = acmeName.split(/\s+/)[0]!;
    const r = await call(AMINA, "POST", "/sessions", { text: `prepare the ${first} renewal` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reopened: true, conversation: { id: renewalId } });
  });

  it("a person renames it; the name survives and is never overwritten", async () => {
    const r = await call(AMINA, "PATCH", `/sessions/${renewalId}`, { title: `Acme fleet renewal ${TAG}` });
    expect(r.body.conversation).toMatchObject({ title: `Acme fleet renewal ${TAG}`, titleSource: "person" });
    expect((await call(AMINA, "GET", `/sessions/${renewalId}`)).body.conversation.title).toBe(`Acme fleet renewal ${TAG}`);
    expect((await call(AMINA, "PATCH", `/sessions/${renewalId}`, { title: "x" })).status).toBe(400);
  });

  it("linked to a Work item, its status is the work's, derived — and Search finds it by the workflow and client", async () => {
    const w = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), incidentSummary: `Hit at Westlands ${TAG}.`, policyId: (await sql`select id from policies where client_id = ${ACME} and deleted_at is null limit 1`)[0]!["id"], source: "ask" });
    expect(w.status).toBe(201);
    const workItemId = w.body.item.id as string;
    const s = await call(AMINA, "POST", "/sessions", { text: `Report the Westlands accident ${TAG}`, scope: { kind: "client", id: ACME }, workItemId });
    expect(s.status).toBe(201);
    expect(s.body.conversation).toMatchObject({ purpose: "claim", workItem: { id: workItemId } });
    // Derived from the Work item and its run: never a value anyone wrote on the conversation.
    expect(["draft", "working", "needs_information"]).toContain(s.body.conversation.status);
    expect(s.body.conversation.title).toMatch(/accident claim$/);
    // The same Work item from "Ask about this" reopens it.
    expect((await call(AMINA, "POST", "/sessions", { text: "what is next here?", workItemId })).body).toMatchObject({ reopened: true, conversation: { id: s.body.conversation.id } });
    const found = await call(AMINA, "GET", `/sessions?q=${encodeURIComponent(`${acmeName.split(/\s+/)[0]} accident claim`)}`);
    expect(found.body.conversations.map((x: { id: string }) => x.id)).toContain(s.body.conversation.id);
    const byClient = await call(AMINA, "GET", `/sessions?q=${encodeURIComponent(acmeName.split(/\s+/)[0]!)}`);
    expect(byClient.body.conversations.length).toBeGreaterThan(0);
  });

  it("a conversation is personal: a colleague cannot read, rename or reopen it", async () => {
    expect((await call(KAMAU, "GET", `/sessions/${renewalId}`)).status).toBe(404);
    expect((await call(KAMAU, "PATCH", `/sessions/${renewalId}`, { title: "Taken over" })).status).toBe(404);
    expect((await call(KAMAU, "GET", "/sessions")).body.conversations.map((x: { id: string }) => x.id)).not.toContain(renewalId);
  });

  it("another brokerage sees none of it, and cannot link its work to it", async () => {
    expect((await call(BETA, "GET", `/sessions/${renewalId}`)).status).toBe(404);
    const w = await sql`select id from work_items where organization_id = ${ORG_A} limit 1`;
    const s = await call(BETA, "POST", "/sessions", { text: "Look at this", workItemId: w[0]!["id"] });
    expect(s.status).toBe(404);
  });

  it("an empty request is refused, and a vague one is never left untitled", async () => {
    expect((await call(AMINA, "POST", "/sessions", { text: "  " })).status).toBe(400);
    const r = await call(AMINA, "POST", "/sessions", { text: "hi" });
    expect(r.body.conversation.title).toMatch(/^Ask about /);
  });
});

describe("Recent and Pins", () => {
  it("opening a record twice is one entry at the top; titles are re-read from the record", async () => {
    await call(AMINA, "POST", "/recent", { ref: { ws: "client", clientId: ACME }, title: "Stale name" });
    await call(AMINA, "POST", "/recent", { ref: { ws: "work" }, title: "Work" });
    await call(AMINA, "POST", "/recent", { ref: { clientId: ACME, ws: "client", query: "typed" }, title: "Stale name" });
    const r = await call(AMINA, "GET", "/recent");
    const top = r.body.items[0];
    expect(top).toMatchObject({ kind: "client", title: acmeName, ref: { ws: "client", clientId: ACME } });
    expect(r.body.items.filter((x: { key: string }) => x.key === top.key)).toHaveLength(1);
  });

  it("a conversation in Recent carries its own current title and kind", async () => {
    const s = await call(AMINA, "POST", "/sessions", { text: `Import the October policy schedules ${TAG}` });
    await call(AMINA, "POST", "/recent", { conversationId: s.body.conversation.id });
    const items = (await call(AMINA, "GET", "/recent")).body.items;
    expect(items[0]).toMatchObject({ kind: "conversation", conversationId: s.body.conversation.id, title: "Import October policy schedules" });
  });

  it("a pin persists on the server and shows in Recent; unpinning removes only the pin", async () => {
    const p = await call(AMINA, "PUT", "/space-pins", { ref: { ws: "client", clientId: ACME }, title: acmeName });
    expect(p.body.pinned).toBe(true);
    expect((await call(AMINA, "GET", "/space-pins")).body.items.map((x: { title: string }) => x.title)).toContain(acmeName);
    expect((await call(AMINA, "GET", "/recent")).body.items.find((x: { key: string }) => x.key === p.body.key).pinned).toBe(true);
    await call(AMINA, "DELETE", `/space-pins?key=${encodeURIComponent(p.body.key)}`);
    expect((await call(AMINA, "GET", "/space-pins")).body.items.find((x: { key: string }) => x.key === p.body.key)).toBeUndefined();
  });

  it("Recent and Pins are per person and per brokerage, under RLS too", async () => {
    expect((await call(KAMAU, "GET", "/recent")).body.items.find((x: { title: string; kind: string }) => x.title === acmeName && x.kind === "client")).toBeUndefined();
    expect((await call(BETA, "GET", "/recent")).body.items).toHaveLength(0);
    // Straight at the table, the browser's own way: another person's rows are invisible and unwritable.
    const read = await browser(KAMAU, "GET", `recent_items?user_id=eq.${AMINA.id}`);
    expect(read.body).toEqual([]);
    const write = await browser(BETA, "POST", "recent_items", { organization_id: ORG_A, user_id: BETA.id, ref_key: "ws=x", kind: "record", ref: { ws: "x" }, title: "x" });
    expect(write.status).toBeGreaterThanOrEqual(400);
  });
});
