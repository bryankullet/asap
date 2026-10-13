/**
 * The progressive experience API on real Postgres (D-172): the real API, supabase-js, PostgREST and
 * RLS. Three intentions compose three different structures from the brokerage's records; asking
 * refines them; governed actions go through the endpoints that own them; continuity is per person
 * and brokerage; nothing crosses a tenant.
 */
import { experienceResponseSchema, subjectKey, validateExperienceSpec, type ASAPExperienceSpec, type LayoutNode } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const iso = (d: Date) => d.toISOString().slice(0, 10);
let policyId = "";
let periodId = "";

const types = (n: LayoutNode): string[] => {
  const kids: LayoutNode[] =
    n.type === "slot" ? [] : n.type === "stack" || n.type === "grid" ? n.children : n.type === "split" ? [...n.children] : n.type === "flow" ? [n.current] : n.type === "table" ? [n.table, ...(n.detail ? [n.detail] : [])] : n.type === "tabs" ? n.tabs.map((t) => t.child) : n.type === "overlay" ? [n.base, ...(n.overlay ? [n.overlay] : [])] : n.type === "dock" ? [n.main, n.dock] : [n.primary, ...n.context];
  return [n.type, ...kids.flatMap(types)];
};
const components = (s: ASAPExperienceSpec) => s.components.map((c) => c.component);
const spec = (body: unknown) => experienceResponseSchema.parse(body).spec;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-experiences')`;
  app = buildApp(API_KEY, [
    { match: /signed the ngugi family/i, reply: { text: '{"intent":"create_client","client":"Ngugi family","cover":null,"window":null}', toolCalls: [], stop: "end" } },
    { match: /onboard otieno/i, reply: { text: '{"intent":"create_client","client":"Wairimu Estates","cover":null,"window":null}', toolCalls: [], stop: "end" } },
  ]);
  const today = new Date();
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const ends = new Date(Math.min(today.getTime() + 5 * 86_400_000, monthEnd.getTime()));
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"EXP-" + TAG}) returning id`;
  policyId = pol!.id;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values (${ORG_A}, ${policyId}, ${iso(new Date(ends.getTime() - 360 * 86_400_000))}, ${iso(ends)}, 1850000, 'KES', 'gross') returning id`;
  periodId = per!.id;
});
afterAll(async () => {
  await sql.end();
});

describe("Experience A — add a new client", () => {
  let id = "";
  it("opens straight into a minimal, progressive form", async () => {
    const r = await call(KAMAU, "POST", "/experiences", { text: "Add a new client" });
    expect(r.status).toBe(201);
    const s = spec(r.body);
    id = s.experienceId;
    expect(s.intent).toMatchObject({ kind: "create_client", interpretedBy: "rules", progress: "waiting_input" });
    expect(s.layout.type).toBe("flow");
    expect(components(s)).toEqual(["ProgressiveForm"]);
    const form = s.components[0]!.props as { fields: { name: string; stage: number; required: boolean }[] };
    // Only what POST /clients requires is asked first; the contact waits until asked for.
    expect(form.fields.filter((f) => f.stage === 0).map((f) => f.name)).toEqual(["name", "kind"]);
    expect(s.actions.find((a) => a.payload.kind === "client.create")?.disabledReason).toBeNull();
  });

  it("saves through the existing endpoint, then confirms from the saved record", async () => {
    const name = `Experience Client ${TAG}`;
    const created = await call(KAMAU, "POST", "/clients", { name, kind: "corporate", contact: { fullName: "Grace Wanjiku", roleLabel: null, email: "grace@example.test", phone: null } });
    expect(created.status).toBe(201);
    expect(created.body.outcome).toBe("created");
    const clientId = created.body.file.client.id as string;
    const after = await call(KAMAU, "POST", `/experiences/${id}/events`, { kind: "action_result", action: "save", ref: { type: "client", id: clientId, label: name }, outcome: "done" });
    expect(after.status).toBe(200);
    const s = spec(after.body);
    expect(s.revision).toBe(2);
    expect(s.intent.progress).toBe("complete");
    expect(components(s)).toEqual(["Confirmation"]);
    const c = s.components[0]!.props as { heading: string; lines: string[] };
    expect(c.heading).toBe(`${name} is on file`);
    expect(c.lines.join(" ")).toContain("Grace Wanjiku");
    expect(s.context.primary).toEqual({ type: "client", id: clientId, label: name });
    // Refreshing restores the same outcome from the session and the record.
    const again = spec((await call(KAMAU, "GET", `/experiences/${id}`)).body);
    expect(components(again)).toEqual(["Confirmation"]);
  });

  it("refuses a result naming a client the person cannot read", async () => {
    const r = await call(KAMAU, "POST", "/experiences", { text: "Add a new client" });
    const other = await sql<{ id: string }[]>`select id from clients where organization_id <> ${ORG_A} limit 1`;
    const bad = await call(KAMAU, "POST", `/experiences/${spec(r.body).experienceId}/events`, { kind: "action_result", action: "save", ref: { type: "client", id: other[0]!.id, label: "X" }, outcome: "done" });
    expect(bad.status).toBe(404);
  });

  it("keeps the person's own words as a draft, never as a record", async () => {
    const r = await call(KAMAU, "POST", "/experiences", { text: `Add Wanjiru Holdings ${TAG} as a new client` });
    const body = experienceResponseSchema.parse(r.body);
    expect(body.ui.drafts["client"]?.["name"]).toBe(`Wanjiru Holdings ${TAG}`);
    const rows = await sql`select 1 from clients where name = ${`Wanjiru Holdings ${TAG}`}`;
    expect(rows.length).toBe(0);
  });

  it("offers a read-only member the form with the reason it cannot save, and the endpoint refuses", async () => {
    const s = spec((await call(READER, "POST", "/experiences", { text: "Add a new client" })).body);
    expect(s.actions.find((a) => a.payload.kind === "client.create")?.disabledReason).toMatch(/cannot add clients/);
    const refused = await call(READER, "POST", "/clients", { name: `Reader ${TAG}`, kind: "corporate" });
    expect(refused.status).toBe(403);
  });
});

describe("Experience B — explore expiring policies", () => {
  let id = "";
  it("composes a table of real policy periods for the window", async () => {
    const r = await call(AMINA, "POST", "/experiences", { text: "Show me motor policies expiring this month" });
    expect(r.status).toBe(201);
    const s = spec(r.body);
    id = s.experienceId;
    expect(s.intent.kind).toBe("explore_policies");
    expect(s.layout.type).toBe("table");
    expect(components(s)).toEqual(["FilterBar", "RecordTable"]);
    const t = s.components.find((c) => c.component === "RecordTable")!.props as { rows: { ref: { id: string }; cells: Record<string, string | null> }[] };
    const mine = t.rows.find((x) => x.ref.id === periodId);
    expect(mine?.cells["policy"]).toBe(`EXP-${TAG}`);
    expect(mine?.cells["premium"]).toBe("KES 1,850,000.00");
    // "motor" names every motor class of the brokerage's own; it is not a class it does not use.
    const chips = (s.components.find((c) => c.component === "FilterBar")!.props as { chips: { label: string }[]; unclear: string | null });
    expect(chips.chips.map((c) => c.label)).toContain("Motor classes");
    expect(chips.unclear).toBeNull();
  });

  it("opens a selected row's detail beside the table, and keeps the filters", async () => {
    const r = await call(AMINA, "POST", `/experiences/${id}/events`, { kind: "select", ref: { type: "policy_period", id: periodId, label: null } });
    const s = spec(r.body);
    expect(components(s)).toEqual(["FilterBar", "RecordTable", "RecordDetail"]);
    const d = s.components.find((c) => c.component === "RecordDetail")!.props as { heading: string; facts: { label: string; value: string }[] };
    expect(d.heading).toBe("Acme Motors");
    expect(d.facts.find((f) => f.label === "Expiring premium")?.value).toBe("KES 1,850,000.00");
    expect(s.actions.map((a) => a.payload.kind)).toContain("experience.start");
  });

  it("refines by asking — only overdue — without losing the window", async () => {
    const r = await call(AMINA, "POST", `/experiences/${id}/ask`, { text: "only show overdue renewals", baseRevision: 2 });
    const s = spec(r.body);
    expect(s.revision).toBe(3);
    const chips = (s.components.find((c) => c.component === "FilterBar")!.props as { chips: { label: string }[] }).chips.map((c) => c.label);
    expect(chips).toContain("Overdue only");
    expect(chips.some((c) => c.startsWith("Ending in "))).toBe(true);
    const t = s.components.find((c) => c.component === "RecordTable")!.props as { rows: { ref: { id: string } }[] };
    // Our period ends in the future: not overdue, so not listed.
    expect(t.rows.some((x) => x.ref.id === periodId)).toBe(false);
  });

  it("is never another brokerage's, and a foreign record cannot be selected into it", async () => {
    expect((await call(BETA, "GET", `/experiences/${id}`)).status).toBe(404);
    const theirs = spec((await call(BETA, "POST", "/experiences", { text: "Show me motor policies expiring this month" })).body);
    const t = theirs.components.find((c) => c.component === "RecordTable")!.props as { rows: { ref: { id: string } }[] };
    expect(t.rows.some((x) => x.ref.id === periodId)).toBe(false);
    const sel = await call(BETA, "POST", `/experiences/${theirs.experienceId}/events`, { kind: "select", ref: { type: "policy_period", id: periodId, label: null } });
    const s = spec(sel.body);
    expect(components(s)).not.toContain("RecordDetail");
  });
});

describe("Experience C — renew an existing policy", () => {
  let id = "";
  let workItemId = "";
  it("finds the client and the policy, asking only when more than one fits", async () => {
    const r = await call(AMINA, "POST", "/experiences", { text: "Help me renew Acme's motor fleet" });
    expect(r.status).toBe(201);
    let s = spec(r.body);
    id = s.experienceId;
    expect(s.intent.kind).toBe("renew_policy");
    if (components(s).includes("RecordChoice")) {
      const choice = s.components.find((c) => c.component === "RecordChoice")!.props as { choices: { ref: { id: string } }[] };
      expect(choice.choices.some((c) => c.ref.id === policyId)).toBe(true);
      s = spec((await call(AMINA, "POST", `/experiences/${id}/events`, { kind: "select", ref: { type: "policy", id: policyId, label: null } })).body);
    }
    expect(components(s)).toEqual(expect.arrayContaining(["ContextSummary", "GovernedAction"]));
    const start = s.actions.find((a) => a.payload.kind === "renewal.start")!;
    expect(start.payload).toEqual({ kind: "renewal.start", policyPeriodId: periodId });
    expect(start.confirm?.effects.length).toBeGreaterThan(0);
  });

  it("starts through the existing endpoint and becomes the evolving working context", async () => {
    const started = await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: periodId });
    expect(["done", "already"]).toContain(started.body.outcome);
    workItemId = started.body.run.workItemId;
    const s = spec((await call(AMINA, "POST", `/experiences/${id}/events`, { kind: "action_result", action: "start", ref: { type: "work_item", id: workItemId, label: null }, outcome: "done" })).body);
    expect(components(s)).toEqual(expect.arrayContaining(["ContextSummary", "Milestones", "NextSteps"]));
    expect(s.context.primary?.id).toBe(workItemId);
    const header = s.components.find((c) => c.component === "ContextSummary")!.props as { heading: string; facts: { label: string; value: string }[] };
    expect(header.heading).toContain("Acme Motors");
    // The workflow start links the period and the run: the cover's end and the run's work are known.
    expect(header.facts.find((f) => f.label === "Cover ends")?.value).not.toBe("No period linked");
    expect(s.withdrawn).toEqual([]);
  });

  it("recomposes around a request, goes back, and refuses to decide for the client", async () => {
    const asked = spec((await call(AMINA, "POST", `/experiences/${id}/ask`, { text: "What is blocking this renewal?", baseRevision: 1 })).body);
    expect(asked.layout.type).toBe("focus");
    expect(components(asked)).toContain("Answer");
    const back = spec((await call(AMINA, "POST", `/experiences/${id}/ask`, { text: "go back", baseRevision: asked.revision })).body);
    expect(back.layout.type).not.toBe("focus");
    const refused = spec((await call(AMINA, "POST", `/experiences/${id}/ask`, { text: "Which insurer should we pick?", baseRevision: back.revision })).body);
    const answer = refused.components.find((c) => c.component === "Answer")!.props as { refused: boolean; text: string };
    expect(answer.refused).toBe(true);
    expect(answer.text).toMatch(/does not choose/);
  });

  it("opens a different intention as its own experience, leaving this one as it was", async () => {
    const r = experienceResponseSchema.parse((await call(AMINA, "POST", `/experiences/${id}/ask`, { text: "Add a new client", baseRevision: 1 })).body);
    expect(r.redirect).not.toBeNull();
    expect(r.redirect).not.toBe(id);
    expect(r.spec.intent.kind).toBe("create_client");
    const still = spec((await call(AMINA, "GET", `/experiences/${id}`)).body);
    expect(still.intent.kind).toBe("renew_policy");
  });

  it("starting from a record re-reads it under the session", async () => {
    const ok = await call(AMINA, "POST", "/experiences", { text: "Renew this", subject: { type: "work_item", id: workItemId, label: null } });
    expect(ok.status).toBe(201);
    expect(spec(ok.body).context.primary?.id).toBe(workItemId);
    const foreign = await call(BETA, "POST", "/experiences", { text: "Renew this", subject: { type: "work_item", id: workItemId, label: null } });
    expect(foreign.status).toBe(404);
  });
});

describe("Interpretation, continuity and safety", () => {
  it("uses the model only when no rule matches, keeps only the person's own words, and audits it", async () => {
    const s = spec((await call(KAMAU, "POST", "/experiences", { text: "We just signed the Ngugi family" })).body);
    expect(s.intent).toMatchObject({ kind: "create_client", interpretedBy: "model" });
    const audit = await sql`select 1 from audit_log where action = 'experience.interpreted_by_model' and object_id = ${s.experienceId}`;
    expect(audit.length).toBe(1);
    const invented = experienceResponseSchema.parse((await call(KAMAU, "POST", "/experiences", { text: "please onboard otieno" })).body);
    // The model named a client the person never mentioned: the name is dropped, not used.
    expect(invented.ui.drafts["client"]).toBeUndefined();
  });

  it("says what it cannot set up, and offers what it can", async () => {
    const s = spec((await call(KAMAU, "POST", "/experiences", { text: "Make me a cup of tea" })).body);
    expect(s.intent.kind).toBe("unsupported");
    expect(components(s)).toEqual(["Clarification"]);
  });

  it("keeps interface state per person, refusing a stale write", async () => {
    const s = spec((await call(KAMAU, "POST", "/experiences", { text: "Add a new client" })).body);
    const ui = { drafts: { client: { name: "Half typed" } }, selection: {}, revealed: ["s-client"], dismissed: [], ask: "" };
    const first = await call(KAMAU, "PUT", `/experiences/${s.experienceId}/state`, { baseVersion: 0, ui });
    expect(first.status).toBe(200);
    expect(first.body.uiVersion).toBe(1);
    const stale = await call(KAMAU, "PUT", `/experiences/${s.experienceId}/state`, { baseVersion: 0, ui: { ...ui, drafts: {} } });
    expect(stale.status).toBe(409);
    expect(stale.body.ui.drafts.client.name).toBe("Half typed");
    expect((await call(AMINA, "GET", `/experiences/${s.experienceId}`)).status).toBe(404);
    const back = experienceResponseSchema.parse((await call(KAMAU, "GET", `/experiences/${s.experienceId}`)).body);
    expect(back.ui.drafts["client"]?.["name"]).toBe("Half typed");
  });

  it("lists a person's resumable work, and only theirs", async () => {
    const mine = await call(KAMAU, "GET", "/experiences");
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    const theirs = await call(BETA, "GET", "/experiences");
    const ids = new Set((theirs.body.items as { id: string }[]).map((x) => x.id));
    expect((mine.body.items as { id: string }[]).some((x) => ids.has(x.id))).toBe(false);
  });

  it("every composition it returns validates against the contract and its own authorized references", async () => {
    const r = await call(AMINA, "POST", "/experiences", { text: "Show me motor policies expiring this month" });
    const s = spec(r.body);
    const refs = new Set<string>();
    for (const c of s.components) JSON.stringify(c.props, (_k, v) => (v && typeof v === "object" && "type" in v && "id" in v ? (refs.add(subjectKey(v)), v) : v));
    expect(validateExperienceSpec(s, { authorizedRefs: refs }).ok).toBe(true);
    expect(types(s.layout)).toContain("table");
  });

  it("is not reachable without a session", async () => {
    expect((await app.request("/experiences")).status).toBe(401);
  });
});
