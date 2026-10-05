/**
 * Placement and issuance on the engine, chained (D-142), connected: real API, real database, the
 * worker's event dispatch driven by hand. A recorded client instruction starts placement; ASAP
 * prepares the request as itself, a person approves and sends it, the insurer's confirmation is
 * recorded, ASAP runs the cover check, and cover.confirmed starts issuance, which prepares its own
 * request and stops for a person's approval. Nothing is sent by ASAP.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { AMINA, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 8);
const started = new Date().toISOString();
let opportunityId = "";
let placementId = "";
let clientId = "";

async function pump() {
  for (let round = 0; round < 6; round++) {
    const runIds = (await sql`select id from workflow_runs where subject_id in ${sql([opportunityId || randomUUID(), placementId || randomUUID()])}`).map((r) => r["id"] as string);
    const evs = await sql`select id from events where organization_id = ${ORG_A} and processed_at is null and occurred_at >= ${started}
      and (entity_id in ${sql([opportunityId || randomUUID(), placementId || randomUUID(), ...runIds])}
        or payload->>'opportunityId' = ${opportunityId} or payload->>'placementId' = ${placementId || randomUUID()}) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      const res = await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
      expect(res.status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const runOf = async (workflow: string) => (await sql`select id, state, current_step, exception from workflow_runs where workflow = ${workflow} and subject_id = ${placementId}`)[0];
const pAct = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/actions`, body);
const placement = async () => (await call(AMINA, "GET", `/placements/${placementId}`)).body;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-placement-workflow')`;
  app = buildApp(API_KEY);
});
afterAll(async () => { await sql.end(); });

describe("placement and issuance workflows, chained", () => {
  it("a recorded instruction starts placement; ASAP prepares the request as itself and stops for approval", async () => {
    // Stand-in: KYC clearance has no route yet, so the database owner leaves this client's file
    // cleared, as a person clearing it would. ASAP will not prepare placement on an uncleared file.
    [{ id: clientId }] = (await sql`insert into clients (organization_id, name, kind, source)
      values (${ORG_A}, ${`Chain Hauliers ${TAG} Ltd`}, 'corporate', 'manual') returning id`) as unknown as [{ id: string }];
    await sql`update clients set file_status = 'cleared', file_decided_by = ${AMINA.id}, file_decided_at = now(),
      file_decision_reason = 'KYC documents verified.', refresh_due_at = now() + interval '1 year' where id = ${clientId}`;
    const created = await call(AMINA, "POST", "/opportunities", { clientId, title: `Chain fleet ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
    opportunityId = created.body.opportunityId;
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
    let opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const by = (id: string) => opp.insurers.find((i: { insurerId: string }) => i.insurerId === id);
    for (const [insurerId, premium] of [[JUBILEE, "5310000.00"], [CIC, "5620000.00"]] as const) {
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
        action: "record_response", withoutRequest: true, opportunityInsurerId: by(insurerId).id, outcome: "quoted", receivedAt: "2026-09-05T09:00:00.000Z",
        premiumAmount: premium, premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Quotation letter received by email.",
      })).body.outcome).toBe("done");
    }
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const generated = await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "generate_comparison" });
    await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId: generated.body.comparison.comparison.id });
    const instructed = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, {
      insurerResponseId: by(JUBILEE).response.id, source: "email", evidenceNote: "Client emailed choosing Jubilee.",
      instructedAt: "2026-09-07T10:40:00.000Z", requestedEffectiveAt: "2026-09-10T00:00:00.000Z", requestedExpiryAt: "2027-09-09T00:00:00.000Z",
    });
    expect(instructed.body.outcome).toBe("done");
    placementId = instructed.body.placementId;
    await pump();
    await pump();

    expect(await runOf("placement")).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    const [req] = await sql`select prepared_by, prepared_by_run_id, approved_at from placement_requests r left join placement_request_approvals a on a.placement_request_id = r.id where r.placement_id = ${placementId}`;
    expect(req!["prepared_by"]).toBeNull();
    expect(req!["prepared_by_run_id"]).toBe((await runOf("placement"))!["id"]);
    expect(req!["approved_at"] ?? null).toBeNull();
    expect((await sql`select count(*)::int as n from workflow_runs where workflow = 'placement' and subject_id = ${placementId}`)[0]!["n"]).toBe(1);
  });

  it("a person approves and sends; the run waits on the insurer, named", async () => {
    const p = await placement();
    expect((await pAct({ action: "approve_request", placementRequestId: p.request.id })).body.outcome).toBe("done");
    await pump();
    expect(await runOf("placement")).toMatchObject({ current_step: "submission" });
    expect((await pAct({
      action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email", recipient: "underwriting@jubilee.test",
      sentAt: "2026-09-08T11:02:00.000Z", evidenceNote: "Sent from my mailbox.", idempotencyKey: `wf-${placementId}`,
    })).body.outcome).toBe("done");
    await pump();
    expect(await runOf("placement")).toMatchObject({ state: "waiting_party", current_step: "confirmation" });
  });

  it("the insurer's confirmation: cover check runs, placement finishes, cover.confirmed starts issuance", async () => {
    expect((await pAct({
      action: "record_insurer_response", outcome: "confirmed_as_requested", receivedAt: "2026-09-09T14:10:00.000Z",
      effectiveAt: "2026-09-10T00:00:00.000Z", expiryAt: "2027-09-09T00:00:00.000Z", insurerReference: `CN-${TAG}`,
      evidenceNote: "Cover note received by email.",
    })).body.outcome).toBe("done");
    await pump();
    await pump();
    expect(await runOf("placement")).toMatchObject({ state: "done" });
    expect((await sql`select count(*)::int as n from workflow_receipts where workflow = 'placement' and run_id = ${(await runOf("placement"))!["id"]}`)[0]!["n"]).toBe(1);
    const iss = await runOf("issuance");
    expect(iss).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    const [ir] = await sql`select prepared_by, prepared_by_run_id from issuance_requests where placement_id = ${placementId}`;
    expect(ir).toMatchObject({ prepared_by: null, prepared_by_run_id: iss!["id"] });
    expect((await sql`select count(*)::int as n from email_send_attempts where organization_id = '10000000-0000-4000-8000-00000000000a'`)[0]!["n"]).toBe(0);
    // Replaying the events changes nothing.
    await sql`update events set processed_at = null where organization_id = ${ORG_A} and occurred_at >= ${started} and entity_id = ${placementId}`;
    await pump();
    expect((await sql`select count(*)::int as n from workflow_runs where subject_id = ${placementId}`)[0]!["n"]).toBe(2);
    expect((await sql`select count(*)::int as n from issuance_requests where placement_id = ${placementId}`)[0]!["n"]).toBe(1);
  });
});
