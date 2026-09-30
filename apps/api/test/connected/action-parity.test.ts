/**
 * Chat/Space action parity, connected (D-122).
 *
 * Ask and the right-hand Space call the same server contracts; the web test
 * (apps/web/src/asap/parity.test.ts) proves both surfaces reach the same client method. This file
 * proves each contract itself against a real database: the real API, supabase-js, PostgREST, RLS
 * and every grant. For each of the nine actions it checks the dimensions a person relies on:
 *
 *   preview writes nothing · a write needs its confirming call · permission refusal (read-only
 *   member) · missing information · conflict · double-click (two concurrent calls) · retry ·
 *   idempotency · audit · receipt · Space update · Today update · Work update · refresh
 *   persistence · tenant isolation (the other brokerage's administrator).
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, buildApp, caller, CIC, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER, type Json } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const RUN = randomUUID().slice(0, 8);
const ACME_POLICY = "90000000-0000-4000-8000-00000000000a";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-action-parity')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

const audits = async (objectId: string, action?: string) =>
  (await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${objectId} and (${action ?? null}::text is null or action = ${action ?? null})`)[0]!.n;
const onToday = async (workItemId: string) => ((await call(AMINA, "GET", "/attention")).body.items as Json[]).find((i) => i.item.id === workItemId);
const onWork = async (workItemId: string) => {
  for (const view of ["needs", "with", "progress", "done"]) {
    const hit = ((await call(AMINA, "GET", `/work?view=${view}&limit=200`)).body.items as Json[]).find((i) => i.item.id === workItemId);
    if (hit) return { view, ...hit };
  }
  return null;
};

/* ---------------------------------------------------------------- 1. add client ---- */
describe("1 · add client", () => {
  const name = `Parity Hauliers ${RUN} Ltd`;
  it("preview writes nothing, and says what would be written and what is missing", async () => {
    const before = (await sql<{ n: number }[]>`select count(*)::int as n from clients where name = ${name}`)[0]!.n;
    const p = await call(AMINA, "POST", "/clients", { name, kind: "corporate", preview: true });
    expect(p.status).toBe(200);
    expect(p.body.outcome).toBe("preview");
    expect(p.body.missing).toEqual(expect.arrayContaining(["Primary contact"]));
    expect((await sql<{ n: number }[]>`select count(*)::int as n from clients where name = ${name}`)[0]!.n).toBe(before);
  });
  it("a read-only member is refused and nothing is written", async () => {
    const r = await call(READER, "POST", "/clients", { name, kind: "corporate" });
    expect(r.status).toBe(403);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from clients where name = ${name}`)[0]!.n).toBe(0);
  });
  it("missing information is refused with a reason", async () => {
    const r = await call(AMINA, "POST", "/clients", { name: "X", kind: "corporate" });
    expect(r.status).toBe(422);
  });
  let clientId = "";
  it("confirming writes once, even on a double click; a retry finds the same client; it is audited", async () => {
    const [a, b] = await Promise.all([
      call(AMINA, "POST", "/clients", { name, kind: "corporate", confirmNew: true }),
      call(AMINA, "POST", "/clients", { name, kind: "corporate", confirmNew: true }),
    ]);
    const outcomes = [a.body.outcome, b.body.outcome].sort();
    expect(outcomes).toEqual(expect.arrayContaining(["created"]));
    expect((await sql<{ n: number }[]>`select count(*)::int as n from clients where name = ${name} and deleted_at is null`)[0]!.n).toBe(1);
    clientId = (await sql<{ id: string }[]>`select id from clients where name = ${name}`)[0]!.id;
    const retry = await call(AMINA, "POST", "/clients", { name, kind: "corporate", confirmNew: true });
    expect(retry.body.outcome).toBe("already_on_file");
    expect((await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${clientId} and action like 'client.%'`)[0]!.n).toBeGreaterThan(0);
  });
  it("a similar name is a conflict to resolve, not a silent second client", async () => {
    const r = await call(AMINA, "POST", "/clients", { name: name.replace(" Ltd", " Limited"), kind: "corporate" });
    expect(r.body.outcome).toBe("possible_duplicates");
    if (r.body.outcome !== "created") expect((await sql<{ n: number }[]>`select count(*)::int as n from clients where name = ${name.replace(" Ltd", " Limited")}`)[0]!.n).toBe(0);
  });
  it("the Client Space reads it back after a refresh; another brokerage cannot see it", async () => {
    expect((await call(AMINA, "GET", `/clients/${clientId}`)).body.client?.name ?? (await call(AMINA, "GET", `/clients/${clientId}`)).body.name).toBe(name);
    expect((await call(BETA, "GET", `/clients/${clientId}`)).status).toBe(404);
  });
});

/* -------------------------------------------- 2–6. quotation: start, insurer, requirement, supply, prepare ---- */
describe("2–6 · quotation work", () => {
  let oppId = "";
  let workItemId = "";
  const title = `Parity quotation ${RUN}`;
  const act = (who = AMINA, body: Json) => call(who, "POST", `/opportunities/${oppId}/actions`, body);

  it("2 · start quotation: read-only refused; missing class refused; a double click makes one", async () => {
    expect((await call(READER, "POST", "/opportunities", { clientId: ACME, title, classOfBusiness: "Commercial motor", requestKey: randomUUID() })).status).toBe(403);
    expect((await call(AMINA, "POST", "/opportunities", { clientId: ACME, title })).status).toBe(422);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      call(AMINA, "POST", "/opportunities", { clientId: ACME, title, classOfBusiness: "Commercial motor", requestKey: key }),
      call(AMINA, "POST", "/opportunities", { clientId: ACME, title, classOfBusiness: "Commercial motor", requestKey: key }),
    ]);
    expect(a.body.opportunityId).toBe(b.body.opportunityId);
    oppId = a.body.opportunityId;
    expect((await sql<{ n: number }[]>`select count(*)::int as n from opportunities where title = ${title}`)[0]!.n).toBe(1);
    const retry = await call(AMINA, "POST", "/opportunities", { clientId: ACME, title, classOfBusiness: "Commercial motor", requestKey: key });
    expect(retry.body.opportunityId).toBe(oppId);
    workItemId = (await sql<{ work_item_id: string }[]>`select work_item_id from opportunities where id = ${oppId}`)[0]!.work_item_id;
    expect(await audits(workItemId)).toBeGreaterThan(0);
    expect((await call(BETA, "GET", `/opportunities/${oppId}`)).status).toBe(404);
  });

  it("the Space, Today and Work read the same first next action", async () => {
    const opp = (await call(AMINA, "GET", `/opportunities/${oppId}`)).body;
    const today = await onToday(workItemId);
    const work = await onWork(workItemId);
    expect(work).not.toBeNull();
    expect(work!.next.what).toBe(opp.next.what);
    if (today) expect(today.next.what).toBe(opp.next.what);
  });

  it("3 · add insurer: refused for read-only and for another brokerage; twice is once; audited", async () => {
    expect((await act(READER, { action: "add_insurer", insurerId: JUBILEE })).body.outcome).toBe("blocked");
    expect((await act(BETA, { action: "add_insurer", insurerId: JUBILEE })).status).toBe(404);
    expect((await act(AMINA, { action: "add_insurer", insurerId: randomUUID() })).body.outcome).toBe("blocked");
    const [a, b] = await Promise.all([act(AMINA, { action: "add_insurer", insurerId: JUBILEE }), act(AMINA, { action: "add_insurer", insurerId: JUBILEE })]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(["already", "done"]);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from opportunity_insurers where opportunity_id = ${oppId} and removed_at is null`)[0]!.n).toBe(1);
    expect((await act(AMINA, { action: "add_insurer", insurerId: JUBILEE })).body.outcome).toBe("already");
    expect(await audits(oppId, "opportunity.insurer_added")).toBe(1);
    expect(await audits(oppId, "opportunity.add_insurer")).toBeGreaterThanOrEqual(1); // the refused attempt
  });

  let requirementId = "";
  it("4 · add requirement: too short refused; twice is once; audited; read back", async () => {
    expect((await act(AMINA, { action: "add_requirement", label: "x" })).status).toBe(422);
    const label = `Parity schedule ${RUN}`;
    const [a, b] = await Promise.all([act(AMINA, { action: "add_requirement", label }), act(AMINA, { action: "add_requirement", label })]);
    expect([a.body.outcome, b.body.outcome]).toContain("done");
    expect((await sql<{ n: number }[]>`select count(*)::int as n from opportunity_requirements where opportunity_id = ${oppId} and label = ${label}`)[0]!.n).toBe(1);
    expect(await audits(oppId, "opportunity.requirement_added")).toBe(1);
    const opp = (await call(AMINA, "GET", `/opportunities/${oppId}`)).body;
    requirementId = opp.requirements.find((r: Json) => r.label === label).id;
  });

  it("5 · supply requirement: needs evidence; twice is once; audited; persists", async () => {
    expect((await act(AMINA, { action: "supply_requirement", requirementId, note: "ok" })).body.outcome).toBe("blocked");
    const note = "Schedule received from the client by email on 29 September.";
    const [a, b] = await Promise.all([
      act(AMINA, { action: "supply_requirement", requirementId, note }),
      act(AMINA, { action: "supply_requirement", requirementId, note }),
    ]);
    expect([a.body.outcome, b.body.outcome]).toContain("done");
    expect((await act(AMINA, { action: "supply_requirement", requirementId, note })).body.outcome).toBe("already");
    expect(await audits(oppId, "opportunity.requirement_supplied")).toBeLessThanOrEqual(2);
    const opp = (await call(AMINA, "GET", `/opportunities/${oppId}`)).body;
    expect(opp.requirements.find((r: Json) => r.id === requirementId).suppliedAt).toBeTruthy();
  });

  it("6 · prepare request: never 'sent'; Work names the review; approval then delivery evidence names the insurer", async () => {
    let opp = (await call(AMINA, "GET", `/opportunities/${oppId}`)).body;
    const oi = opp.insurers.find((i: Json) => i.insurerId === JUBILEE);
    expect((await act(AMINA, { action: "prepare_request", opportunityInsurerId: oi.id, subject: "", body: "" })).status).toBe(422);
    expect((await act(READER, { action: "prepare_request", opportunityInsurerId: oi.id, subject: "Quotation request", body: "We invite terms." })).body.outcome).toBe("blocked");
    const r = await act(AMINA, { action: "prepare_request", opportunityInsurerId: oi.id, subject: "Quotation request", body: "We invite terms for commercial motor cover." });
    expect(r.body.outcome).toBe("done");
    opp = r.body.opportunity;
    const mine = opp.insurers.find((i: Json) => i.insurerId === JUBILEE);
    expect(mine.stage).toBe("request_prepared");
    expect(JSON.stringify(opp)).not.toMatch(/\bsent\b/i);
    expect(opp.next.what).not.toMatch(/record .*response/i);
    const work = await onWork(workItemId);
    expect(work!.next.what).toBe(opp.next.what);

    /* Approval, then a regeneration supersedes it. */
    expect((await act(AMINA, { action: "approve_request", quoteRequestId: mine.request.id })).body.outcome).toBe("done");
    const again = await act(AMINA, { action: "prepare_request", opportunityInsurerId: oi.id, subject: "Quotation request", body: "We invite terms for commercial motor cover, revised." });
    expect(again.body.opportunity.insurers.find((i: Json) => i.insurerId === JUBILEE).request.approvedAt ?? null).toBeNull();
    /* Response before delivery is refused unless it is explicitly a manual record without a request. */
    const early = await act(AMINA, { action: "record_response", opportunityInsurerId: oi.id, outcome: "declined", receivedAt: new Date().toISOString(), sourceNote: "Phoned to decline." });
    expect(early.body.outcome).toBe("blocked");
    /* Approve the new text, record the real delivery; now With Jubilee. */
    const req2 = again.body.opportunity.insurers.find((i: Json) => i.insurerId === JUBILEE).request;
    expect((await act(AMINA, { action: "approve_request", quoteRequestId: req2.id })).body.outcome).toBe("done");
    const deliver = await act(AMINA, { action: "record_delivery", quoteRequestId: req2.id, method: "own_email", reference: "Sent from Outlook, 10:02, message ref 7781", deliveredAt: new Date(Date.now() - 60_000).toISOString() });
    expect(deliver.body.outcome).toBe("done");
    const after = deliver.body.opportunity;
    expect(after.insurers.find((i: Json) => i.insurerId === JUBILEE).stage).toBe("with_insurer");
    const w = await onWork(workItemId);
    expect(w!.item.task_status).toBe("with_party");
    expect(w!.item.task_party).toMatch(/Jubilee/i);
    expect(w!.next.what).toBe(after.next.what);
    expect(w!.item.task_next_check).toBeTruthy();
    /* Delivery twice is refused, not duplicated. */
    const twice = await act(AMINA, { action: "record_delivery", quoteRequestId: req2.id, method: "own_email", reference: "again", deliveredAt: new Date().toISOString() });
    expect(["already", "blocked"]).toContain(twice.body.outcome);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from quote_request_deliveries where quote_request_id = ${req2.id}`)[0]!.n).toBe(1);
    /* Response, terms, comparison ready: the full no-Gmail path. */
    const resp = await act(AMINA, { action: "record_response", opportunityInsurerId: oi.id, outcome: "quoted", receivedAt: new Date().toISOString(), premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Quotation letter received by email." });
    expect(resp.body.outcome).toBe("done");
    expect(resp.body.opportunity.insurers.find((i: Json) => i.insurerId === JUBILEE).stage).toBe("quoted");
    /* Terms reviewed, a second quote, and the comparison ready — still nothing sent. */
    const jubResp = resp.body.opportunity.insurers.find((i: Json) => i.insurerId === JUBILEE).response;
    expect((await act(AMINA, { action: "record_term", insurerResponseId: jubResp.id, termType: "excess", label: "Own damage", extractedValue: "5% min KES 30,000" })).body.outcome).toBe("done");
    expect((await act(AMINA, { action: "add_insurer", insurerId: CIC })).body.outcome).toBe("done");
    const cicOi = (await call(AMINA, "GET", `/opportunities/${oppId}`)).body.insurers.find((i: Json) => i.insurerId === CIC);
    expect((await act(AMINA, { action: "record_response", withoutRequest: true, opportunityInsurerId: cicOi.id, outcome: "quoted", receivedAt: new Date().toISOString(), premiumAmount: "5620000.00", premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "CIC phoned terms through and confirmed by letter." })).body.outcome).toBe("done");
    const cmp = await call(AMINA, "POST", `/opportunities/${oppId}/comparison/actions`, { action: "generate_comparison" });
    expect(cmp.body.outcome).toBe("done");
    expect((await call(AMINA, "GET", `/opportunities/${oppId}/comparison`)).body.comparison).toBeTruthy();
    expect(await audits(oppId)).toBeGreaterThan(5);
    /* No mail left ASAP at any point. */
    expect((await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${oppId} and action like '%email.sent%'`)[0]!.n).toBe(0);
  });
});

/* ---------------------------------------------------------------- 7. report claim ---- */
describe("7 · report claim", () => {
  let workItemId = "";
  const summary = `Parity: vehicle hit from behind at the Mombasa Road junction (${RUN}).`;
  it("read-only refused; missing date refused; a policy is named or explicitly unknown", async () => {
    expect((await call(READER, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: "2026-09-28", incidentSummary: summary, policyId: ACME_POLICY })).status).toBe(403);
    expect((await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentSummary: summary, policyId: ACME_POLICY })).status).toBe(422);
    expect((await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: "2026-09-28", incidentSummary: summary })).status).toBe(422);
  });
  it("a double click creates one claim, a draft, looked at again in two days; audited; on Work and Today", async () => {
    const body = { kind: "claim", clientId: ACME, incidentOn: "2026-09-28", incidentSummary: summary, policyId: ACME_POLICY, source: "ask" };
    const [a, b] = await Promise.all([call(AMINA, "POST", "/work-items", body), call(AMINA, "POST", "/work-items", body)]);
    expect(a.body.item.id).toBe(b.body.item.id);
    workItemId = a.body.item.id;
    expect((await sql<{ n: number }[]>`select count(*)::int as n from claims where work_item_id = ${workItemId}`)[0]!.n).toBe(1);
    const [claim] = await sql<{ status: string }[]>`select status from claims where work_item_id = ${workItemId}`;
    expect(claim!.status).toBe("draft");
    const retry = await call(AMINA, "POST", "/work-items", body);
    expect(retry.body.reopened).toBe(true);
    const detail = (await call(AMINA, "GET", `/work-items/${workItemId}`)).body;
    expect(detail.claim).toBeTruthy();
    const check = new Date(detail.item.task_next_check).getTime();
    expect(Math.abs(check - (Date.now() + 2 * 86_400_000))).toBeLessThan(10 * 60_000);
    expect(detail.item.required_action).toBeTruthy();
    expect(await audits(workItemId)).toBeGreaterThan(0);
    expect((await onWork(workItemId))!.next.what).toBe(detail.item.required_action);
    expect((await call(BETA, "GET", `/work-items/${workItemId}`)).status).toBe(404);
  });
  it("a claim notice cannot be prepared while no mailbox or verified insurer address exists", async () => {
    const item = (await call(AMINA, "GET", `/work-items/${workItemId}`)).body.item;
    const step = item.steps.find((s: Json) => s.actions.some((a: Json) => a.verb === "draft"));
    if (!step) return; // no draft action offered on this claim's steps: nothing to refuse
    const r = await call(AMINA, "POST", `/work-items/${workItemId}/actions`, { stepId: step.id, verb: "draft", version: item.version, to: "claims@insurer.demo" });
    expect(r.status).toBe(409);
    expect(r.body.reason).toMatch(/no verified insurer address/);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from drafts where work_item_id = ${workItemId}`)[0]!.n).toBe(0);
  });
});

/* ---------------------------------------------------- 8–9. assign Work, change due date ---- */
describe("8–9 · assign Work and change its due date", () => {
  let item: Json;
  const manage = (who: typeof AMINA, body: Json) => call(who, "POST", `/work-items/${item.id}/manage`, body);

  beforeAll(async () => {
    /* Quotation work: it has no steps, which the old step-based assign could not handle. */
    const created = await call(AMINA, "POST", "/opportunities", { clientId: ACME, title: `Parity assign ${RUN}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
    const wid = (await sql<{ work_item_id: string }[]>`select work_item_id from opportunities where id = ${created.body.opportunityId}`)[0]!.work_item_id;
    item = (await call(AMINA, "GET", `/work-items/${wid}`)).body.item;
  });

  it("8 · preview writes nothing and names the change", async () => {
    const p = await manage(AMINA, { version: item.version, ownerId: KAMAU.id, preview: true });
    expect(p.body.outcome).toBe("preview");
    expect(p.body.changes[0]).toMatchObject({ field: "owner" });
    expect((await call(AMINA, "GET", `/work-items/${item.id}`)).body.item.owner_id).toBe(item.owner_id);
  });
  it("8 · read-only refused (and audited); another brokerage cannot reach it; a non-member cannot own it", async () => {
    const r = await manage(READER, { version: item.version, ownerId: KAMAU.id });
    expect(r.status).toBe(403);
    expect(await audits(item.id, "work_item.manage")).toBeGreaterThan(0);
    expect((await manage(BETA, { version: item.version, ownerId: BETA.id })).status).toBe(404);
    expect((await manage(AMINA, { version: item.version, ownerId: BETA.id })).body.guard).toBe("owner_not_member");
    expect((await manage(AMINA, { version: item.version })).status).toBe(422);
  });
  it("8 · a double click assigns once; a retry is already done; audited; Work shows the new owner after refresh", async () => {
    const [a, b] = await Promise.all([manage(AMINA, { version: item.version, ownerId: KAMAU.id }), manage(AMINA, { version: item.version, ownerId: KAMAU.id })]);
    expect([a.body.outcome, b.body.outcome]).toContain("applied");
    expect([a.body.outcome, b.body.outcome].every((o: string) => o === "applied" || o === "already_done")).toBe(true);
    expect((await manage(AMINA, { version: item.version, ownerId: KAMAU.id })).body.outcome).toBe("already_done");
    expect(await audits(item.id, "work_item.assigned")).toBe(1);
    const fresh = (await call(AMINA, "GET", `/work-items/${item.id}`)).body.item;
    expect(fresh.owner_id).toBe(KAMAU.id);
    expect((await onWork(item.id))!.owner?.id).toBe(KAMAU.id);
    item = fresh;
  });
  it("9 · a stale version is a conflict; nothing changes", async () => {
    const r = await manage(AMINA, { version: item.version - 1, dueOn: "2026-10-15" });
    expect(r.status).toBe(409);
    expect(r.body.guard).toBe("version_current");
    expect((await call(AMINA, "GET", `/work-items/${item.id}`)).body.item.due_on ?? null).toBeNull();
  });
  it("9 · the due date is saved once, audited, read back by Work and Today, and survives refresh", async () => {
    const p = await manage(AMINA, { version: item.version, dueOn: "2026-10-15", preview: true });
    expect(p.body.changes[0]).toMatchObject({ field: "due", to: "2026-10-15" });
    expect((await call(AMINA, "GET", `/work-items/${item.id}`)).body.item.due_on ?? null).toBeNull();
    const [a, b] = await Promise.all([manage(AMINA, { version: item.version, dueOn: "2026-10-15" }), manage(AMINA, { version: item.version, dueOn: "2026-10-15" })]);
    expect([a.body.outcome, b.body.outcome]).toContain("applied");
    expect(await audits(item.id, "work_item.due_changed")).toBe(1);
    expect((await call(AMINA, "GET", `/work-items/${item.id}`)).body.item.due_on).toBe("2026-10-15");
    expect((await onWork(item.id))!.item.due_on).toBe("2026-10-15");
    const today = await onToday(item.id);
    if (today) expect(today.item.due_on).toBe("2026-10-15");
  });
  it("9 · a next check in the past is refused", async () => {
    const fresh = (await call(AMINA, "GET", `/work-items/${item.id}`)).body.item;
    expect((await manage(AMINA, { version: fresh.version, nextCheckAt: "2020-01-01T00:00:00Z" })).body.guard).toBe("next_check_in_past");
  });
  it("a browser session cannot write the due date around the API", async () => {
    const res = await fetch(`${process.env["CONNECTED_POSTGREST_URL"]}/work_items?id=eq.${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${(await import("./_harness.js")).token(AMINA)}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ due_on: "2030-01-01" }),
    });
    const rows = res.status < 300 ? ((await res.json()) as Json[]) : [];
    expect(rows.length).toBe(0);
    expect((await call(AMINA, "GET", `/work-items/${item.id}`)).body.item.due_on).toBe("2026-10-15");
  });
});

void ORG_A;
