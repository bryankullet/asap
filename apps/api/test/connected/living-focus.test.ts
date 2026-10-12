/**
 * Ask ASAP inside a Living workspace on real Postgres (D-165): a request typed in a renewal or claim
 * is read into a typed focus from the record's own names, and the same workspace recomposes around
 * it — validated against the registry rows 0086 seeded. Nothing is written by asking; a request to
 * act or to decide cover is refused with its reason; another brokerage's work does not exist.
 */
import { livingSurfaceSchema, workspaceInterpretationSchema, type LivingSurface } from "@asap/schema";
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
let renewalId = "";
let claimId = "";
type Focus = { question: string; understood: string; items: { label: string; detail: string | null }[]; empty: string | null; emphasis: string[]; source: string };
const focusOf = (s: LivingSurface) => s.blocks.find((b) => b.component === "FocusPanel")?.props as Focus | undefined;
const interpret = async (who: typeof AMINA, id: string, text: string) => {
  const r = await call(who, "POST", `/living/${id}/interpret`, { text });
  return { status: r.status, body: r.status === 200 ? workspaceInterpretationSchema.parse(r.body) : r.body };
};
const focused = async (who: typeof AMINA, id: string, q: Record<string, string>) => {
  const r = await call(who, "GET", `/living/${id}?${new URLSearchParams(q).toString()}`);
  expect(r.status).toBe(200);
  return livingSurfaceSchema.parse(r.body);
};
// Other files run concurrently, so "nothing written" is judged on this work item alone.
const writes = async (id: string) => (await sql<{ n: string }[]>`select (select count(*) from audit_log where organization_id = ${ORG_A} and object_id = ${id})::text || '/' || (select updated_at::text from work_items where id = ${id}) as n`)[0]!.n;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-focus')`;
  app = buildApp(API_KEY);
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"LF-" + TAG}) returning id`;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values (${ORG_A}, ${pol!.id}, ${day(-340)}, ${day(25)}, 3200000, 'KES', 'gross') returning id`;
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_A}, ${pol!.id}, 1, ${day(-340)}, 'seed')`;
  expect((await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: per!.id })).status).toBe(200);
  renewalId = (await sql<{ work_item_id: string }[]>`select work_item_id from workflow_runs where subject_id = ${per!.id}`)[0]!.work_item_id;
  const c = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-2), incidentSummary: `Hit at a junction ${TAG}.`, policyId: pol!.id, source: "ask" });
  expect(c.status).toBe(201);
  claimId = c.body.item.id;
  const claim = (await sql`select id from claims where work_item_id = ${claimId}`)[0]!["id"] as string;
  expect((await call(AMINA, "POST", `/claims/${claim}/actions`, { action: "add_document", label: `Police abstract ${TAG}`, holder: "client" })).status).toBe(200);
});
afterAll(async () => {
  await sql.end();
});

describe("POST /living/:id/interpret", () => {
  it("reads “Compare the revised terms” in a renewal as a comparison, by rule, writing nothing", async () => {
    const before = await writes(renewalId);
    const r = await interpret(AMINA, renewalId, "Compare the revised terms");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ focus: { intent: "compare_revisions" }, source: "rules", unclear: null });
    expect(await writes(renewalId)).toBe(before);
  });

  it("reads “Show what is blocking this claim” in a claim as blockers", async () => {
    const r = await interpret(AMINA, claimId, "Show what is blocking this claim");
    expect(r.body).toMatchObject({ focus: { intent: "blockers", target: null }, source: "rules" });
  });

  it("reads “Bring up the document behind this exclusion” as evidence, and invents no target", async () => {
    const r = await interpret(AMINA, renewalId, "Bring up the document behind this exclusion");
    expect(r.body).toMatchObject({ focus: { intent: "evidence" }, source: "rules" });
    // No term called "exclusion" is on file for this renewal, so nothing is named.
    expect((r.body as { focus: { target: string | null } }).focus.target).toBeNull();
  });

  it("refuses to act or decide cover, and says why", async () => {
    for (const text of ["approve the renewal", "Is this claim covered?", "which insurer should we go with"]) {
      const r = await interpret(AMINA, text.includes("claim") ? claimId : renewalId, text);
      expect(r.body).toMatchObject({ focus: null, explore: null, source: "none" });
      expect((r.body as { unclear: string }).unclear).toBeTruthy();
    }
  });

  it("lets a read-only member ask, and never exists for another brokerage", async () => {
    expect((await interpret(READER, claimId, "who has the next step")).body).toMatchObject({ focus: { intent: "obligations" } });
    expect((await interpret(BETA, claimId, "who has the next step")).status).toBe(404);
    expect((await interpret(BETA, renewalId, "compare the quotes")).status).toBe(404);
  });

  it("rejects an empty or oversized request", async () => {
    expect((await call(AMINA, "POST", `/living/${claimId}/interpret`, { text: "" })).status).toBe(400);
    expect((await call(AMINA, "POST", `/living/${claimId}/interpret`, { text: "x".repeat(501) })).status).toBe(400);
  });
});

describe("GET /living/:id with a focus", () => {
  it("recomposes the claim around its blockers: the answer first, the documents brought forward", async () => {
    const s = await focused(AMINA, claimId, { focus: "blockers", fq: "Show what is blocking this claim", fsrc: "rules" });
    const f = focusOf(s)!;
    const leads = s.blocks.filter((b) => b.role === "lead").length;
    expect(leads).toBeGreaterThan(0);
    expect(s.blocks[leads]!.component).toBe("FocusPanel");
    expect(f.question).toBe("Show what is blocking this claim");
    expect(f.items.map((i) => i.label)).toContain(`Police abstract ${TAG} — not received`);
    expect(f.emphasis).toContain("documents");
    expect(s.blocks.slice(leads + 1, leads + 5).map((b) => b.id)).toContain("documents");
    expect(JSON.stringify(s)).not.toMatch(/\b(not covered|repudiat|liab)\w*/i);
  });

  it("abstains when no document is linked to the term asked about, rather than showing something else", async () => {
    const s = await focused(AMINA, renewalId, { focus: "evidence", target: "Exclusions", fq: "Bring up the document behind this exclusion" });
    const f = focusOf(s)!;
    expect(f.items).toEqual([]);
    expect(f.empty).toMatch(/Exclusions/);
  });

  it("brings the revised terms forward in the renewal", async () => {
    const s = await focused(AMINA, renewalId, { focus: "compare_revisions", fq: "Compare the revised terms" });
    expect(focusOf(s)!.understood).toBeTruthy();
  });

  it("ignores a focus it does not know, and keeps the question as text", async () => {
    const plain = await focused(AMINA, claimId, { focus: "drop_tables" });
    expect(focusOf(plain)).toBeUndefined();
    const evil = await focused(AMINA, claimId, { focus: "history", fq: `<img src=x onerror=alert(1)>` });
    expect(focusOf(evil)!.question).toBe(`<img src=x onerror=alert(1)>`);
  });

  it("is the same composition on refresh", async () => {
    const q = { focus: "obligations", fq: "who has it" };
    const a = await focused(AMINA, claimId, q);
    const b = await focused(AMINA, claimId, q);
    expect(b.blocks.map((x) => [x.id, x.hash])).toEqual(a.blocks.map((x) => [x.id, x.hash]));
  });
});
