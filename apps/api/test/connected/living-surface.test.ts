/**
 * The Living renewal surface on real Postgres (D-156): the real API, supabase-js, PostgREST, RLS
 * and the registry rows migration 0079 seeded. A renewal is detected by the real sweep; the surface
 * is then read by people in each brokerage and role.
 */
import { homeChangesResponseSchema, livingSurfaceSchema, portfolioResponseSchema } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

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
  // Started for this one period, not by the global sweep: a sweep advances every brokerage's runs
  // and would race other files' in-flight work (it made mailbox-delivery count extra sends).
  const started = await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: per!.id });
  expect(started.status).toBe(200);
  const [run] = await sql<{ work_item_id: string }[]>`select work_item_id from workflow_runs where subject_id = ${per!.id}`;
  workItemId = run!.work_item_id;
  // Renewals, claims and policy changes have workspaces (D-161); any other kind does not.
  const [other] = await sql<{ id: string }[]>`select id from work_items where organization_id = ${ORG_A} and kind not in ('renewal', 'claim', 'endorsement') and deleted_at is null limit 1`;
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
    // Related work and response patterns read other work in the brokerage, which other test files
    // change concurrently; everything composed from this renewal's own records must not move.
    const own = (s: typeof a) => s.blocks.filter((x) => x.id !== "related" && x.id !== "patterns").map((x) => [x.id, x.hash]);
    expect(own(b)).toEqual(own(a));
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
    // The audit history is the "recent" block; "This cover before" (also a Timeline) is not audit.
    if (n === 0) expect(s.blocks.some((b) => b.id === "recent")).toBe(false);
    expect(n === 0 || n === 1).toBe(true);
  });

  it("refuses a kind with no workspace, an unknown id and a malformed id alike", async () => {
    if (otherItemId) expect((await call(AMINA, "GET", `/living/${otherItemId}`)).status).toBe(404);
    expect((await call(AMINA, "GET", `/living/${randomUUID()}`)).status).toBe(404);
    expect((await call(AMINA, "GET", "/living/not-an-id")).status).toBe(404);
  });

  it("is not reachable without a session", async () => {
    const res = await app.request(`/living/${workItemId}`);
    expect(res.status).toBe(401);
  });
});

describe("surface preferences (0080, D-157)", () => {
  const key = () => `renewal:${workItemId}`;
  it("keeps one person's arrangement for them, in their brokerage", async () => {
    const put = await call(AMINA, "PUT", `/surface-preferences/${key()}`, { pinned: ["quotes"], collapsed: ["recent"], selection: { quotes: "Jubilee" }, lastSeenAt: null });
    expect(put.status).toBe(200);
    const got = await call(AMINA, "GET", `/surface-preferences/${key()}`);
    expect(got.body.prefs).toMatchObject({ pinned: ["quotes"], collapsed: ["recent"], selection: { quotes: "Jubilee" } });
    const [row] = await sql<{ organization_id: string; user_id: string }[]>`select organization_id, user_id from surface_preferences where surface_key = ${key()} and user_id = ${AMINA.id}`;
    expect(row).toEqual({ organization_id: ORG_A, user_id: AMINA.id });
  });
  it("is never a colleague's, and never another brokerage's", async () => {
    expect((await call(KAMAU, "GET", `/surface-preferences/${key()}`)).body.prefs.pinned).toEqual([]);
    expect((await call(BETA, "GET", `/surface-preferences/${key()}`)).body.prefs.pinned).toEqual([]);
  });
  it("refuses business data or free text in place of an arrangement", async () => {
    expect((await call(AMINA, "PUT", `/surface-preferences/${key()}`, { pinned: [], collapsed: [], selection: {}, lastSeenAt: null, premium: "KES 1" })).status).toBe(400);
    expect((await call(AMINA, "GET", "/surface-preferences/bad%20key")).status).toBe(400);
  });
});

describe("governed commands from the surface (D-157)", () => {
  type Cmd = { kind: "command"; command: string; target: string; payload: Record<string, unknown>; label: string };
  const commandsOf = (surface: { blocks: { component: string; actions: { kind: string }[] }[] }, component: string) =>
    (surface.blocks.find((b) => b.component === component)?.actions ?? []).filter((a): a is Cmd => a.kind === "command");

  it("shows the waiting bundle in full, with approve and return commands, to a person who may approve", async () => {
    const s = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    const bundle = s.blocks.find((b) => b.component === "ApprovalBundle");
    expect(bundle, "the renewal waiting for approval shows its bundle").toBeTruthy();
    expect((bundle!.props as { items: { body: string }[] }).items.every((i) => i.body.length > 0)).toBe(true);
    expect(commandsOf(s, "ApprovalBundle").map((c) => c.payload["decision"])).toEqual(["approve", "reject"]);
  });

  it("offers a reader no command, and the endpoint refuses one sent anyway", async () => {
    const amina = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    const approve = commandsOf(amina, "ApprovalBundle")[0]!;
    const reader = livingSurfaceSchema.parse((await call(READER, "GET", `/living/${workItemId}`)).body);
    expect(commandsOf(reader, "ApprovalBundle")).toEqual([]);
    const forced = await call(READER, "POST", `/workflow-approvals/${approve.target}/decide`, approve.payload);
    expect(forced.status).toBe(403);
    const [run] = await sql<{ state: string }[]>`select state from workflow_runs where work_item_id = ${workItemId}`;
    expect(run!.state).toBe("waiting_approval");
  });

  it("approving through the surface's command uses the existing endpoint, and the surface moves on", async () => {
    const before = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    const approve = commandsOf(before, "ApprovalBundle")[0]!;
    const r = await call(AMINA, "POST", `/workflow-approvals/${approve.target}/decide`, approve.payload);
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("done");
    const [a] = await sql<{ state: string }[]>`select state from workflow_approvals where id = ${approve.target}`;
    expect(a!.state).toBe("approved");
    const after = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${workItemId}`)).body);
    expect(after.blocks.some((b) => b.component === "ApprovalBundle")).toBe(false);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    // The same command again changes nothing: the frozen approval is already decided.
    const again = await call(AMINA, "POST", `/workflow-approvals/${approve.target}/decide`, approve.payload);
    expect(["already", "blocked"]).toContain(again.body.outcome);
  });
});

describe("the renewal portfolio (D-158)", () => {
  const groupsOf = (body: unknown) => {
    const r = portfolioResponseSchema.parse(body);
    const g = r.surface.blocks.find((b) => b.component === "PortfolioGroups")!.props as { groups: { label: string; rows: { policy: string; workItemId: string | null }[] }[]; selected: number };
    return { r, g, policies: g.groups.flatMap((x) => x.rows.map((y) => y.policy)) };
  };
  it("reads the brokerage's renewals for a window refined in words, and links each to its workspace", async () => {
    const res = await call(AMINA, "POST", "/living/portfolio", { query: null, text: "renewals in the next 60 days by insurer" });
    expect(res.status).toBe(200);
    const { r, g, policies } = groupsOf(res.body);
    expect(r.interpretation.query.groupBy).toBe("insurer");
    expect(r.interpretation.query.window.label).toBe("in the next 60 days");
    expect(policies).toContain(`LIV-${TAG}`);
    const row = g.groups.flatMap((x) => x.rows).find((x) => x.policy === `LIV-${TAG}`)!;
    expect(row.workItemId).toBe(workItemId);
  });
  it("refines the current view: an insurer named in this brokerage filters to it", async () => {
    const first = portfolioResponseSchema.parse((await call(AMINA, "POST", "/living/portfolio", { query: null, text: "next 60 days" })).body);
    const res = await call(AMINA, "POST", "/living/portfolio", { query: first.interpretation.query, text: "only jubilee" });
    const { r, policies } = groupsOf(res.body);
    expect(r.interpretation.query.window.label).toBe("in the next 60 days");
    expect(r.interpretation.query.filters.insurers).toEqual([JUBILEE]);
    expect(policies).toContain(`LIV-${TAG}`);
  });
  it("never shows another brokerage's renewals, whatever the request", async () => {
    const res = await call(BETA, "POST", "/living/portfolio", { query: null, text: "renewals in the next 60 days" });
    expect(res.status).toBe(200);
    expect(groupsOf(res.body).policies).not.toContain(`LIV-${TAG}`);
    expect(JSON.stringify(res.body)).not.toContain(`LIV-${TAG}`);
  });
  it("refuses a malformed query rather than guessing one", async () => {
    expect((await call(AMINA, "POST", "/living/portfolio", { query: { subject: "claims" }, text: null })).status).toBe(400);
  });
});

describe("Home: what changed since you last looked (D-159)", () => {
  it("tells a person what a colleague did on their work, links it, and keeps the visit's starting point", async () => {
    const first = homeChangesResponseSchema.parse((await call(AMINA, "GET", "/home/changes")).body);
    // A colleague delivers the approved insurer request and records it, through the quotation workflow.
    const [q] = await sql<{ id: string; opportunity_id: string }[]>`select qr.id, oi.opportunity_id from quote_requests qr
      join opportunity_insurers oi on oi.id = qr.opportunity_insurer_id join opportunities o on o.id = oi.opportunity_id
      where o.work_item_id = ${workItemId} and qr.approved_at is not null limit 1`;
    expect(q, "the approved renewal has an approved insurer request").toBeTruthy();
    const r = await call(KAMAU, "POST", `/opportunities/${q!.opportunity_id}/actions`, { action: "record_delivery", quoteRequestId: q!.id, method: "portal", reference: `Portal ref ${TAG}` });
    expect(r.status).toBe(200);
    const after = homeChangesResponseSchema.parse((await call(AMINA, "GET", "/home/changes")).body);
    expect(after.since).toBe(first.since);
    const line = after.changes.find((c) => c.text === "A request was delivered to an insurer" && c.ref?.["workItemId"] === workItemId);
    expect(line, JSON.stringify(after.changes)).toBeTruthy();
    expect(line!.ref).toEqual({ ws: "living", workItemId });
    expect(line!.actor).toBeTruthy();
    expect(JSON.stringify(line)).not.toMatch(/Portal ref/);
  });
  it("does not tell a person about their own action, and never another brokerage's", async () => {
    const mine = homeChangesResponseSchema.parse((await call(KAMAU, "GET", "/home/changes")).body);
    expect(mine.changes.some((c) => c.text === "A request was delivered to an insurer" && c.ref?.["workItemId"] === workItemId)).toBe(false);
    const other = homeChangesResponseSchema.parse((await call(BETA, "GET", "/home/changes")).body);
    expect(other.changes.some((c) => c.ref?.["workItemId"] === workItemId)).toBe(false);
  });
});

// Timing is measured on its own (pnpm test:connected:perf, D-169): inside the parallel suite thirty
// files share one small Postgres, and the number measures that contention, not the composition.
describe.skipIf(!process.env["CONNECTED_PERF"])("composition time (D-163)", () => {
  it("composes the renewal workspace and the portfolio quickly on a real database", async () => {
    const time = async (f: () => Promise<unknown>) => { const t = performance.now(); await f(); return performance.now() - t; };
    const renewal: number[] = [];
    const portfolio: number[] = [];
    for (let i = 0; i < 10; i++) {
      renewal.push(await time(() => call(AMINA, "GET", `/living/${workItemId}`)));
      portfolio.push(await time(() => call(AMINA, "POST", "/living/portfolio", { query: null, text: "renewals in the next 60 days by insurer" })));
    }
    const p95 = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!;
    // eslint-disable-next-line no-console -- the measured numbers are the point of this test; they go in the implementation map
    console.info(`living composition p95: renewal ${p95(renewal).toFixed(0)} ms, portfolio ${p95(portfolio).toFixed(0)} ms`);
    expect(p95(renewal)).toBeLessThan(1500);
    expect(p95(portfolio)).toBeLessThan(1500);
  });
});

