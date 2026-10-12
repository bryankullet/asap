/**
 * The Living renewal surface on real Postgres (D-156): the real API, supabase-js, PostgREST, RLS
 * and the registry rows migration 0079 seeded. A renewal is detected by the real sweep; the surface
 * is then read by people in each brokerage and role.
 */
import { livingSurfaceSchema } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TAG = randomUUID().slice(0, 6);
let workItemId = "";
let otherItemId = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living')`;
  app = buildApp(API_KEY);
  await sql`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
    select ${ORG_A}, ${ACME}, 'Wanjiru Kamau', 'wanjiru@acme.test', true
    where not exists (select 1 from client_contacts where client_id = ${ACME} and email is not null and deleted_at is null)`;
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"LIV-" + TAG}) returning id`;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values (${ORG_A}, ${pol!.id}, ${iso(new Date(Date.now() - 340 * DAY))}, ${iso(new Date(Date.now() + 25 * DAY))}, 3200000, 'KES', 'gross') returning id`;
  await app.request("/internal/workflows/sweep", { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
  const [run] = await sql<{ work_item_id: string }[]>`select work_item_id from workflow_runs where subject_id = ${per!.id}`;
  workItemId = run!.work_item_id;
  const [other] = await sql<{ id: string }[]>`select id from work_items where organization_id = ${ORG_A} and kind <> 'renewal' and deleted_at is null limit 1`;
  otherItemId = other?.id ?? "";
});
afterAll(async () => {
  await sql.end();
});

describe("GET /living/:workItemId", () => {
  it("composes a valid, registered surface for the renewal from the brokerage's records", async () => {
    const r = await call(AMINA, "GET", `/living/${workItemId}`);
    expect(r.status).toBe(200);
    const s = livingSurfaceSchema.parse(r.body);
    expect(s.subject.id).toBe(workItemId);
    expect(s.blocks[0]!.component).toBe("ContextHeader");
    expect(s.blocks.map((b) => b.component)).toEqual(expect.arrayContaining(["RenewalJourney", "CoverageEffectiveState"]));
    const header = s.blocks[0]!.props as { title: string; facts: { label: string; value: string }[] };
    expect(header.title).toContain(`LIV-${TAG}`);
    expect(header.facts.find((f) => f.label === "Expiring insurer")?.value).toBeTruthy();
    const cover = s.blocks.find((b) => b.component === "CoverageEffectiveState")!.props as { renewed: unknown; daysToExpiry: number };
    expect(cover.renewed).toBeNull();
    expect(cover.daysToExpiry).toBeGreaterThan(20);
  });

  it("is stable: reading twice with nothing changed gives the same block hashes", async () => {
    const a = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    const b = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    expect(b.blocks.map((x) => [x.id, x.hash])).toEqual(a.blocks.map((x) => [x.id, x.hash]));
  });

  it("never exists for another brokerage", async () => {
    const r = await call(BETA, "GET", `/living/${workItemId}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(`LIV-${TAG}`);
  });

  it("shows a read-only member the work, without the audit history they may not view", async () => {
    const r = await call(READER, "GET", `/living/${workItemId}`);
    expect(r.status).toBe(200);
    const s = livingSurfaceSchema.parse(r.body);
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from role_permissions rp
      join organization_memberships m on m.role_id = rp.role_id join permissions p on p.id = rp.permission_id
      where m.user_id = ${READER.id} and m.organization_id = ${ORG_A} and p.object_type = 'audit' and p.verb = 'view'`;
    const n = rows[0]!.n;
    // Whichever way the role is configured, the audit history follows the permission, never the screen.
    if (n === 0) expect(s.blocks.some((b) => b.component === "Timeline")).toBe(false);
    expect(n === 0 || n === 1).toBe(true);
  });

  it("refuses what is not a renewal, an unknown id and a malformed id alike", async () => {
    if (otherItemId) expect((await call(AMINA, "GET", `/living/${otherItemId}`)).status).toBe(404);
    expect((await call(AMINA, "GET", `/living/${randomUUID()}`)).status).toBe(404);
    expect((await call(AMINA, "GET", "/living/not-an-id")).status).toBe(404);
  });

  it("is not reachable without a session", async () => {
    const res = await app.request(`/living/${workItemId}`);
    expect(res.status).toBe(401);
  });
});
