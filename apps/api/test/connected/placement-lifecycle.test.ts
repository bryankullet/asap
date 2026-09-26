/**
 * The placement lifecycle, connected (4B-4B).
 *
 * The real API — Hono routes, the placement service, the prepared-action service, the Ask tool loop
 * and the production Supabase factory — against a disposable PostgreSQL built from the migration
 * files, through a real PostgREST. Every request reaches the database as `authenticated` with a
 * signed JWT, so RLS, grants, triggers and the API-key gate are the real ones. No service-role key
 * is used: the factory is given a string that is not a key, so any use of it would fail loudly.
 *
 * The one stand-in is Supabase Auth's token lookup (`GET /auth/v1/user`), answered here from the
 * same HS256 token PostgREST verifies. The model is the deterministic provider, scripted to call
 * the controlled `prepare_placement_action` tool.
 *
 * Run by scripts/test-connected.sh, which starts PostgREST; excluded from the ordinary run.
 */
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import pino from "pino";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeProvider, type FakeScript } from "../../src/ai/providers/fake.js";
import { createApp } from "../../src/app.js";
import type { Mailer } from "../../src/mail/index.js";
import { createSupabaseFactory } from "../../src/supabase.js";

const REST = process.env["CONNECTED_POSTGREST_URL"]!;
const SECRET = process.env["CONNECTED_JWT_SECRET"]!;
const OWNER = process.env["CONNECTED_OWNER_URL"]!;

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test" }; // administrator, A
const KAMAU = { id: "a0000000-0000-4000-8000-000000000002", email: "kamau@connected.test" }; // account executive, A
const BETA = { id: "b0000000-0000-4000-8000-000000000001", email: "beta@connected.test" }; // administrator, B
const ACME = "70000000-0000-4000-8000-00000000000a";
const JUBILEE = "60000000-0000-4000-8000-00000000000a";
const CIC = "60000000-0000-4000-8000-00000000000b";
const SUPABASE = "http://supabase.connected.test";
const API_KEY = `connected-internal-key-${randomUUID()}`;

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function jwt(claims: Record<string, unknown>): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
const token = (u: { id: string; email: string }) => jwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated" });

/** `/rest/v1/*` goes to PostgREST; `/auth/v1/user` is answered from the verified token. */
const transport: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith(`${SUPABASE}/auth/v1/user`)) {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const [head, body, sig] = auth.replace(/^Bearer\s+/i, "").split(".");
    const valid = sig !== undefined && createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url") === sig;
    if (!valid) return new Response(JSON.stringify({ msg: "invalid token" }), { status: 401 });
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString()) as { sub: string; email: string };
    return new Response(
      JSON.stringify({ id: claims.sub, email: claims.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (url.startsWith(`${SUPABASE}/rest/v1`)) return fetch(url.replace(`${SUPABASE}/rest/v1`, REST), init);
  throw new Error(`connected test: unexpected request to ${url}`);
};

/* The Ask script is filled in once the placement exists; the provider reads it at call time. */
const askScript: FakeScript = [];
const silentMailer = { send: async () => ({ ok: true as const }), sendInvitation: async () => {} } as unknown as Mailer;
const buildApp = () =>
  createApp({
    logger: pino({ level: process.env["CONNECTED_LOG"] ?? "silent" }),
    build: { version: "connected", commit: "connected" },
    supabase: createSupabaseFactory({
      url: SUPABASE,
      anonKey: jwt({ role: "anon" }),
      serviceRoleKey: "not-a-key: the connected test never uses the service role",
      apiInternalKey: API_KEY,
      fetch: transport,
    }),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: false,
    executor: () => async () => {},
    bootToken: "connected",
    aiProvider: fakeProvider(askScript),
  });

let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;

// Test-only: bodies are asserted field by field against the contracts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(who: { id: string; email: string }, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token(who)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}
const act = (who: { id: string; email: string }, placementId: string, body: unknown) => call(who, "POST", `/placements/${placementId}/actions`, body);
const read = async (placementId: string, who = AMINA) => (await call(who, "GET", `/placements/${placementId}`)).body;

const ids: Record<string, unknown> = {};
const counts = async (placementId: string) => {
  const [r] = await sql<{ requests: number; work: number; open: number; versions: number; instructions: number; acceptances: number; resolutions: number; executed: number; audits: number }[]>`
    select
      (select count(*)::int from placement_requests where placement_id = ${placementId}) as requests,
      (select count(*)::int from work_items where source_id = ${placementId}) as work,
      (select count(*)::int from work_items where source_id = ${placementId} and task_status <> 'done') as open,
      (select count(*)::int from placement_basis_versions where placement_id = ${placementId}) as versions,
      (select count(*)::int from client_instructions ci join placements p on p.opportunity_id = ci.opportunity_id where p.id = ${placementId}) as instructions,
      (select count(*)::int from client_change_acceptances where placement_id = ${placementId}) as acceptances,
      (select count(*)::int from client_condition_resolutions where placement_id = ${placementId}) as resolutions,
      (select count(*)::int from prepared_actions where placement_id = ${placementId} and state = 'executed') as executed,
      (select count(*)::int from audit_log where organization_id = ${ORG_A} and object_id = ${placementId}) as audits`;
  return r!;
};
const openWork = async (placementId: string) =>
  (await sql<{ reason_code: string; task_status: string }[]>`
    select reason_code, task_status from work_items where source_id = ${placementId} and task_status <> 'done'`).map((w) => w.reason_code);

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-lifecycle')`;
  app = buildApp();
});

afterAll(async () => {
  if (process.env["CONNECTED_REPORT"]) writeFileSync(process.env["CONNECTED_REPORT"], JSON.stringify(ids, null, 2));
  await sql.end();
});

describe("the placement lifecycle, connected to a real database", () => {
  let opportunityId = "";
  let placementId = "";
  let preparedId = "";

  it("1. creates the opportunity and comparable quotes through the API", async () => {
    const created = await call(AMINA, "POST", "/opportunities", {
      clientId: ACME, title: `Connected fleet quotation — ${randomUUID().slice(0, 8)}`, classOfBusiness: "Commercial motor",
      riskSummary: "Fleet of five delivery vehicles", requestKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    opportunityId = created.body.opportunityId;
    ids["opportunityId"] = opportunityId;

    for (const insurerId of [JUBILEE, CIC]) {
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId })).status).toBe(200);
    }
    let opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const byInsurer = (id: string) => opp.insurers.find((i: { insurerId: string }) => i.insurerId === id);
    for (const [insurerId, premium] of [[JUBILEE, "5310000.00"], [CIC, "5620000.00"]] as const) {
      const res = await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
        action: "record_response", opportunityInsurerId: byInsurer(insurerId).id, outcome: "quoted",
        receivedAt: "2026-09-05T09:00:00.000Z", premiumAmount: premium, premiumCurrency: "KES", validUntil: "2027-06-30",
        sourceNote: "Quotation letter received by email.",
      });
      if (res.body.outcome !== "done") throw new Error(JSON.stringify(res));
      expect(res.body.outcome).toBe("done");
    }
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const jubileeResponse = byInsurer(JUBILEE).response.id;
    ids["jubileeResponseId"] = jubileeResponse;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
      action: "record_term", insurerResponseId: jubileeResponse, termType: "excess", label: "Own damage", extractedValue: "5% min KES 30,000",
    })).body.outcome).toBe("done");

    const generated = await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "generate_comparison" });
    expect(generated.body.outcome).toBe("done");
    const comparisonId = generated.body.comparison.comparison.id;
    ids["comparisonId"] = comparisonId;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId })).body.outcome).toBe("done");
  });

  it("2–3. records the client's instruction, with a condition and no end date, which creates the placement", async () => {
    const res = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, {
      insurerResponseId: ids["jubileeResponseId"], source: "telephone",
      evidenceNote: "Client rang at 10:40 on 7 September and chose Jubilee on the terms shown.",
      instructedAt: "2026-09-07T10:40:00.000Z", requestedEffectiveAt: "2026-09-10T00:00:00.000Z",
      conditions: ["Subject to a satisfactory motor inspection"],
    });
    expect(res.body).toMatchObject({ outcome: "done" });
    placementId = res.body.placementId;
    ids["placementId"] = placementId;
    const p = await read(placementId);
    ids["instructionV1"] = p.instruction.id;
    ids["conditionId"] = p.conditions[0].id;
    expect(p.conditions).toEqual([expect.objectContaining({ text: "Subject to a satisfactory motor inspection", state: "unresolved" })]);
    expect(await openWork(placementId)).toEqual(["prepare_request"]);
  });

  it("4. Ask prepares the request through the controlled tool, and nothing is recorded", async () => {
    askScript.push({
      match: /prepare the placement request/i,
      reply: { text: "", toolCalls: [{ id: "c1", name: "prepare_placement_action", arguments: { actionType: "prepare_request", placementId } }], stop: "tool_use" },
      then: {
        text: JSON.stringify({ type: "answer", target: null, panel: null, view: "summary", answer: "I have prepared the placement request. It waits on the placement for you to confirm; nothing is recorded until you do.", suggestions: [] }),
        toolCalls: [],
        stop: "end",
      },
    });
    const asked = await call(AMINA, "POST", "/ask", { question: "Prepare the placement request", scope: { kind: "placement", id: placementId } });
    if (asked.status !== 200) throw new Error(JSON.stringify(asked));
    expect(asked.status).toBe(200);
    expect(asked.body.state).toBe("answered");
    expect(asked.body.message.tools_used.map((t: { name: string }) => t.name)).toEqual(["prepare_placement_action"]);

    const prepared = await sql<{ id: string; state: string; prepared_by: string; fingerprint: string }[]>`
      select id, state, prepared_by, fingerprint from prepared_actions where placement_id = ${placementId}`;
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ state: "prepared", prepared_by: AMINA.id });
    preparedId = prepared[0]!.id;
    ids["preparedActionId"] = preparedId;
    expect((await counts(placementId)).requests).toBe(0);
    expect((await read(placementId)).preparedActions[0]).toMatchObject({ id: preparedId, state: "prepared", permitted: true, blockers: [] });
  });

  it("5–7. confirming executes it exactly once, and Work moves to the approval", async () => {
    const other = await call(KAMAU, "POST", `/prepared-actions/${preparedId}/confirm`);
    expect(other.body.outcome).toBe("refused");
    expect((await counts(placementId)).requests).toBe(0);

    const first = await call(AMINA, "POST", `/prepared-actions/${preparedId}/confirm`);
    expect(first.body.outcome).toBe("done");
    expect(first.body.action.receipt.message).toMatch(/Prepare the placement request to Jubilee — done/);
    const second = await call(AMINA, "POST", `/prepared-actions/${preparedId}/confirm`);
    expect(second.body.outcome).toBe("already");
    expect(second.body.action.receipt).toEqual(first.body.action.receipt);

    const c = await counts(placementId);
    expect(c.requests).toBe(1);
    expect(c.executed).toBe(1);
    expect(await openWork(placementId)).toEqual(["approval_required"]);
    const [executedAudits] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${preparedId} and action = 'prepared_action.executed'`;
    expect(executedAudits!.n).toBe(1);
  });

  it("a stale, an expired and a malformed prepared action are refused and change nothing", async () => {
    const stale = await call(AMINA, "POST", `/placements/${placementId}/prepare`, { actionType: "approve_request" });
    expect(stale.body.state).toBe("prepared");
    const staleId = stale.body.action.id;
    // The placement moves under it: a new version of the request supersedes the one it approves.
    expect((await act(AMINA, placementId, { action: "prepare_request", subject: "Placement instruction — Acme Motors (v2)", body: "Please place cover on the quoted terms.", coverRequested: "Commercial motor, five vehicles" })).body.outcome).toBe("done");
    const refusedStale = await call(AMINA, "POST", `/prepared-actions/${staleId}/confirm`);
    expect(refusedStale.body).toMatchObject({ outcome: "refused", action: { state: "stale" } });

    const expiring = await call(AMINA, "POST", `/placements/${placementId}/prepare`, { actionType: "approve_request" });
    const expiringId = expiring.body.action.id;
    // Test setup, as the owner: simulate the clock passing. Triggers are bypassed for this one write.
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update prepared_actions set expires_at = now() - interval '1 minute' where id = ${expiringId}`;
    });
    const refusedExpired = await call(AMINA, "POST", `/prepared-actions/${expiringId}/confirm`);
    expect(refusedExpired.body).toMatchObject({ outcome: "refused", action: { state: "expired" } });

    const malformed = await call(AMINA, "POST", `/placements/${placementId}/prepare`, { actionType: "prepare_issuance" });
    const malformedId = malformed.body.action.id;
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update prepared_actions set payload = ${sql.json({ action: "approve_request", placementRequestId: "not-a-uuid" })} where id = ${malformedId}`;
    });
    const refusedMalformed = await call(AMINA, "POST", `/prepared-actions/${malformedId}/confirm`);
    expect(refusedMalformed.body).toMatchObject({ outcome: "refused", action: { state: "refused" } });

    const [approvals] = await sql<{ n: number }[]>`
      select count(*)::int as n from placement_request_approvals a join placement_requests r on r.id = a.placement_request_id where r.placement_id = ${placementId}`;
    expect(approvals!.n).toBe(0);
    ids["refusedActions"] = { stale: staleId, expired: expiringId, malformed: malformedId };
  });

  it("8. approves, records sending, and records the insurer's confirmation on changed terms", async () => {
    let p = await read(placementId);
    expect((await act(AMINA, placementId, { action: "approve_request", placementRequestId: p.request.id })).body.outcome).toBe("done");
    p = await read(placementId);
    expect((await act(AMINA, placementId, {
      action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email",
      recipient: "underwriting@jubilee.test", sentAt: "2026-09-08T11:02:00.000Z",
      evidenceNote: "Sent from my own mailbox at 11:02 on 8 September to the Jubilee desk.", idempotencyKey: `connected-${placementId}`,
    })).body.outcome).toBe("done");
    expect(await openWork(placementId)).toEqual(["awaiting_insurer"]);

    const confirmed = await act(AMINA, placementId, {
      action: "record_insurer_response", outcome: "confirmed_with_changes", receivedAt: "2026-09-09T14:10:00.000Z",
      effectiveAt: "2026-09-10T00:00:00.000Z", expiryAt: "2027-09-09T23:59:59.000Z", insurerReference: "CN-CONNECTED-1",
      changesNote: "Own damage excess raised to 7.5%, minimum KES 45,000; the insurer set the period end.",
      termChanges: [{ termType: "excess", label: "Own damage", value: "7.5% min KES 45,000" }],
      evidenceNote: "Cover note CN-CONNECTED-1 received by email at 14:10.",
    });
    expect(confirmed.body.outcome).toBe("done");
  });

  it("9–10. checks the confirmation field by field, and keeps cover reality apart from the client's agreement", async () => {
    const p = await read(placementId);
    ids["coverMatchV1"] = p.coverMatch.id;
    const item = (label: string) => p.coverMatch.items.find((i: { label: string }) => i.label === label);
    expect(item("Own damage")).toMatchObject({ classification: "changed", acceptedValue: "5% min KES 30,000", confirmedValue: "7.5% min KES 45,000", material: true });
    expect(item("Cover ends")).toMatchObject({ classification: "added_by_insurer", material: true, acceptedValue: null });
    expect(item("Premium").classification).toBe("match");
    expect(p.coverMatch).toMatchObject({ current: true, materialDifferences: 2, comparedByName: null });

    expect(p.cover.state).toBe("active");
    expect(p.cover.line).toMatch(/on the insurer's changed terms/);
    expect(p.changeAcceptance).toBeNull();
    expect(p.readiness.state).toBe("blocked");
    expect(p.readiness.reasons.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(["unaccepted_differences", "condition_unresolved"]));
    expect(await openWork(placementId)).toEqual(["review_changed_terms"]);
  });

  it("11–13. the client accepts the changes: a new instruction version, basis version 2, Work moves once", async () => {
    const before = await counts(placementId);
    const res = await act(AMINA, placementId, {
      action: "record_client_acceptance", coverMatchId: ids["coverMatchV1"], decision: "accept_all", source: "email",
      decidedAt: "2026-09-10T09:00:00.000Z", evidenceNote: "Client's finance director replied at 09:00 accepting the excess and the period end.",
    });
    expect(res.body.outcome).toBe("done");

    const p = await read(placementId);
    ids["instructionV2"] = p.instruction.id;
    expect(p.instruction.id).not.toBe(ids["instructionV1"]);
    const [v2] = await sql<{ revises_instruction_id: string }[]>`select revises_instruction_id from client_instructions where id = ${p.instruction.id}`;
    expect(v2!.revises_instruction_id).toBe(ids["instructionV1"]);
    const [v1] = await sql<{ superseded_at: Date | null }[]>`select superseded_at from client_instructions where id = ${ids["instructionV1"] as string}`;
    expect(v1!.superseded_at).not.toBeNull();
    expect(p.basis).toMatchObject({ version: 2, origin: "client_accepted_changes", expiryAt: "2027-09-09T23:59:59+00:00" });
    expect(p.coverMatch).toMatchObject({ current: true, materialDifferences: 0, basisVersion: 2 });
    expect(p.changeAcceptance).toMatchObject({ decision: "accept_all" });

    const after = await counts(placementId);
    expect(after.versions).toBe(before.versions + 1);
    expect(after.instructions).toBe(before.instructions + 1);
    expect(await openWork(placementId)).toEqual(["resolve_client_conditions"]);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from work_items where source_id = ${placementId} and reason_code = 'resolve_client_conditions'`;
    expect(n!.n).toBe(1);
  });

  it("14–16. readiness stays blocked on the unresolved condition, then becomes ready when it is resolved with evidence", async () => {
    let p = await read(placementId);
    expect(p.cover.state).toBe("active");
    expect(p.readiness).toMatchObject({ state: "blocked" });
    expect(p.readiness.reasons.map((r: { code: string }) => r.code)).toEqual(["condition_unresolved"]);
    expect((await act(AMINA, placementId, { action: "prepare_issuance" })).body.outcome).toBe("blocked");

    const resolved = await act(AMINA, placementId, {
      action: "resolve_client_condition", conditionId: ids["conditionId"], resolution: "satisfied",
      reason: "Motor inspection completed and passed.", resolvedAt: "2026-09-11T10:00:00.000Z",
      evidenceNote: "Assessor's inspection report dated 11 September, received by email and filed.",
    });
    expect(resolved.body.outcome).toBe("done");

    p = await read(placementId);
    expect(p.conditions[0]).toMatchObject({ state: "satisfied", resolvedByName: expect.any(String), reason: "Motor inspection completed and passed." });
    expect(p.readiness).toMatchObject({ state: "ready", reasons: [] });
    expect(await openWork(placementId)).toEqual(["issue_policy"]);
    ids["issuanceWorkItemId"] = p.readiness.workItemId;
    expect(p.readiness.workItemId).not.toBeNull();
  });

  it("17. the same state survives re-reading, and a fresh API instance reads it identically", async () => {
    const first = await read(placementId);
    const again = await read(placementId);
    app = buildApp();
    const fresh = await read(placementId);
    for (const p of [again, fresh]) {
      expect(p.readiness).toEqual(first.readiness);
      expect(p.work).toEqual(first.work);
      expect(p.conditions).toEqual(first.conditions);
      expect(p.basis).toEqual(first.basis);
      expect(p.changeAcceptance).toEqual(first.changeAcceptance);
      expect(p.coverMatch).toEqual(first.coverMatch);
    }
  });

  it("18. audit rows and the prepared action's receipt exist", async () => {
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where organization_id = ${ORG_A} and object_id = ${placementId} order by occurred_at`).map((a) => a.action);
    for (const expected of ["placement.instruction_recorded", "placement.request_prepared", "placement.request_approved", "placement.submission_recorded",
      "placement.insurer_confirmed_with_changes", "placement.cover_checked", "placement.client_accepted_changes", "placement.condition_satisfied"]) {
      expect(actions).toContain(expected);
    }
    const [row] = await sql<{ state: string; receipt: { message: string }; decided_by: string }[]>`select state, receipt, decided_by from prepared_actions where id = ${preparedId}`;
    expect(row).toMatchObject({ state: "executed", decided_by: AMINA.id });
    expect(row!.receipt.message).toMatch(/— done/);
    const [actor] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${placementId} and actor_user_id = ${AMINA.id}`;
    expect(actor!.n).toBeGreaterThan(0);
    ids["auditActions"] = actions;
  });

  it("19. replaying every step creates no duplicate record, Work item, version or audit result", async () => {
    const before = await counts(placementId);
    expect((await call(AMINA, "POST", `/prepared-actions/${preparedId}/confirm`)).body.outcome).toBe("already");
    expect((await act(AMINA, placementId, {
      action: "record_client_acceptance", coverMatchId: ids["coverMatchV1"], decision: "accept_all", source: "email",
      decidedAt: "2026-09-10T09:00:00.000Z", evidenceNote: "Client's finance director replied at 09:00 accepting the excess and the period end.",
    })).body.outcome).not.toBe("done");
    expect((await act(AMINA, placementId, {
      action: "resolve_client_condition", conditionId: ids["conditionId"], resolution: "satisfied",
      reason: "Motor inspection completed and passed.", resolvedAt: "2026-09-11T10:00:00.000Z",
      evidenceNote: "Assessor's inspection report dated 11 September, received by email and filed.",
    })).body.outcome).toBe("already");
    expect((await act(AMINA, placementId, { action: "prepare_issuance" })).body.outcome).toBe("already");
    await read(placementId);
    const after = await counts(placementId);
    expect(after).toEqual(before);
    ids["finalCounts"] = after;
  });

  it("20. another brokerage cannot read or act on any record in the chain", async () => {
    expect((await call(BETA, "GET", `/placements/${placementId}`)).status).toBe(404);
    expect((await act(BETA, placementId, { action: "prepare_issuance" })).status).toBe(404);
    expect((await call(BETA, "POST", `/prepared-actions/${preparedId}/confirm`)).status).toBe(404);
    expect((await call(BETA, "POST", `/placements/${placementId}/prepare`, { actionType: "prepare_issuance" })).status).toBe(404);
    expect((await call(BETA, "GET", `/opportunities/${opportunityId}`)).status).toBe(404);

    // And straight through PostgREST with B's own session: every table in the chain is empty to them.
    for (const table of ["placements", "client_instructions", "placement_requests", "placement_insurer_responses", "cover_match_results",
      "client_change_acceptances", "placement_client_conditions", "client_condition_resolutions", "prepared_actions", "placement_basis_versions"]) {
      const res = await fetch(`${REST}/${table}?select=id&organization_id=eq.${ORG_A}`, { headers: { Authorization: `Bearer ${token(BETA)}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    }
    const [beforeB] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where organization_id = ${ORG_B} and object_id = ${placementId}`;
    expect(beforeB!.n).toBe(0);
  });

  it("a browser session — no server-held key — cannot write a placement record through PostgREST", async () => {
    const res = await fetch(`${REST}/placement_requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token(AMINA)}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ organization_id: ORG_A, placement_id: placementId, version: 9, subject: "Forged", body_text: "Forged", cover_requested: "Forged", effective_at: "2026-09-10T00:00:00Z", sha256: "0".repeat(64), prepared_by: AMINA.id }),
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/api_only/);
    const patched = await fetch(`${REST}/prepared_actions?id=eq.${preparedId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token(AMINA)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ changes: ["forged"] }),
    });
    expect(patched.status).toBeGreaterThanOrEqual(400);
    const anon = await fetch(`${REST}/prepared_actions?select=id`, { headers: { Authorization: `Bearer ${jwt({ role: "anon" })}` } });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});
