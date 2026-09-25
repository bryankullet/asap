/**
 * Opportunities and the terms that come back (D-084).
 *
 * What these lock is that the lifecycle cannot lie:
 *   - a prepared request is not approved, and an approved one is not sent;
 *   - a quoted response must say where it came from;
 *   - a decline says why, and silence carries no premium;
 *   - a correction never destroys what was extracted;
 *   - an insurer cannot be approached twice, and nothing is created twice by a second click;
 *   - permissions come from the session, and one brokerage sees none of another's.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLERK = { id: "a0000000-0000-4000-8000-000000000002", email: "clerk@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";

const CLIENT = "20000000-0000-4000-8000-00000000000a";
const WORK = "26000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const THEIR_OPP = "30000000-0000-4000-8000-00000000000b";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const INS_B = "21000000-0000-4000-8000-00000000000b";
const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
const iso = "2026-09-05T09:00:00.000Z";

function membership(userId: string, roleId: string) {
  return {
    id: `60000000-0000-4000-8000-00000000000${userId.slice(-1)}`,
    organization_id: ORG,
    user_id: userId,
    is_owner: roleId === ADMIN_ROLE,
    status: "active",
    joined_at: iso,
    organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
    role: { id: roleId, key: "r", name: "R", description: null, is_system: true },
  };
}

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-clerk": CLERK },
    inserts: [],
    rpc: {
      // The engine owns work items. It answers with an id, as the real function does.
      work_item_create: () => ({ data: { id: WORK, reopened: false } }),
    },
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: CLERK.id, email: CLERK.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(CLERK.id, READONLY_ROLE)],
      role_permissions: [
        { role_id: ADMIN_ROLE, permission: { object_type: "space", verb: "create" } },
        { role_id: ADMIN_ROLE, permission: { object_type: "email", verb: "approve" } },
      ],
      clients: [
        { id: CLIENT, organization_id: ORG, name: "Acme Ltd", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null },
      ],
      insurers: [
        { id: INS_A, organization_id: ORG, name: "Insurer A" },
        { id: INS_B, organization_id: ORG, name: "Insurer B" },
      ],
      work_items: [
        { id: WORK, organization_id: ORG, client_id: CLIENT, kind: "new_business", title: "Fleet quotation — 2027", task_status: "needs_you", task_party: null, task_since: null, created_at: iso, deleted_at: null },
      ],
      requirement_templates: [
        { id: "32000000-0000-4000-8000-00000000000a", organization_id: ORG, class_of_business: "Commercial motor", label: "Vehicle schedule with declared values", required: true, position: 0 },
        { id: "32000000-0000-4000-8000-00000000000b", organization_id: ORG, class_of_business: "Commercial motor", label: "Previous year claims history", required: true, position: 1 },
      ],
      opportunities: [
        { id: OPP, organization_id: ORG, client_id: CLIENT, work_item_id: WORK, title: "Acme motor fleet quotation — 2027", class_of_business: "Commercial motor", risk_summary: "Five commercial vehicles", cover_start: null, cover_end: null, source_email_message_id: null, source_document_id: null, owner_id: AMINA.id, created_by: AMINA.id, created_at: iso, closed_at: null, closed_outcome: null, closed_reason: null },
        { id: THEIR_OPP, organization_id: OTHER_ORG, client_id: "20000000-0000-4000-8000-0000000000ff", work_item_id: "26000000-0000-4000-8000-0000000000ff", title: "Not yours", class_of_business: "Motor", created_by: "b0000000-0000-4000-8000-000000000001", created_at: iso, closed_at: null },
      ],
      opportunity_requirements: [
        { id: "33000000-0000-4000-8000-00000000000a", organization_id: ORG, opportunity_id: OPP, label: "Vehicle schedule with declared values", required: true, position: 0, supplied_at: null, supplied_by: null, evidence_document_id: null, evidence_email_message_id: null, evidence_note: null },
      ],
      opportunity_insurers: [
        { id: APPROACH_A, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
      ],
      quote_requests: [],
      insurer_responses: [],
      quote_terms: [],
      documents: [],
      email_messages: [],
      audit_log: [],
    },
    /*
     * Column defaults the stand-in does not apply but Postgres does. Without them a freshly
     * inserted row comes back missing `added_at`, which the contract requires — and the route
     * would be failing for the harness's reason rather than its own.
     */
    defaults: {
      opportunity_insurers: { added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
      quote_requests: { prepared_at: iso, approved_at: null, approved_by: null, approved_body_sha256: null, sent_at: null, sent_email_message_id: null },
      insurer_responses: { recorded_at: iso, received_at: null, premium_amount: null, premium_currency: null, valid_until: null, decline_reason: null, source_note: null, source_document_id: null, source_email_message_id: null },
      quote_terms: { position: 0, unclear: false, extracted_value: null, corrected_value: null, corrected_by: null, corrected_at: null, amount: null, currency: null, evidence_document_id: null, evidence_page: null },
      opportunity_requirements: { required: true, position: 0, supplied_at: null, supplied_by: null, evidence_document_id: null, evidence_email_message_id: null, evidence_note: null },
      opportunities: { closed_at: null, closed_outcome: null, closed_reason: null, risk_summary: null, cover_start: null, cover_end: null, source_email_message_id: null, source_document_id: null },
    },
    uniques: {
      opportunity_insurers: [["opportunity_id", "insurer_id"]],
      quote_requests: [["opportunity_insurer_id"]],
      insurer_responses: [["opportunity_insurer_id"]],
      quote_terms: [["insurer_response_id", "term_type", "label"]],
      opportunity_requirements: [["opportunity_id", "label"]],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: process.env["DBG"] ? "error" : "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "t",
  });

beforeEach(() => {
  db = makeDb();
});

const amina = { Authorization: "Bearer tok-amina" };
const clerk = { Authorization: "Bearer tok-clerk" };
const json = (h: Record<string, string>) => ({ ...h, "Content-Type": "application/json" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

const read = async (id = OPP, who = amina) => readJson(await build().request(`/opportunities/${id}`, { headers: who }));
const act = (body: Record<string, unknown>, who = amina, id = OPP) =>
  build().request(`/opportunities/${id}/actions`, { method: "POST", headers: json(who), body: JSON.stringify(body) });

describe("who may reach it", () => {
  it("requires a session", async () => {
    expect((await build().request(`/opportunities/${OPP}`)).status).toBe(401);
  });

  it("refuses another brokerage's opportunity", async () => {
    expect((await build().request(`/opportunities/${THEIR_OPP}`, { headers: amina })).status).toBe(404);
  });

  it("never lists another brokerage's opportunities", async () => {
    const body = await readJson(await build().request("/opportunities", { headers: amina }));
    expect(body.opportunities.map((o: { id: string }) => o.id)).toEqual([OPP]);
  });
});

describe("starting quotation work", () => {
  const start = (over: Record<string, unknown> = {}, who = amina) =>
    build().request("/opportunities", {
      method: "POST",
      headers: json(who),
      body: JSON.stringify({
        clientId: CLIENT,
        title: "Acme motor fleet quotation — 2027",
        classOfBusiness: "Commercial motor",
        requestKey: "40000000-0000-4000-8000-00000000000a",
        ...over,
      }),
    });

  it("creates the work item and the opportunity, and copies the class's requirements in", async () => {
    db.tables["opportunities"] = [];
    db.tables["opportunity_requirements"] = [];
    const res = await start();
    expect(res.status).toBe(201);

    expect(db.tables["opportunities"]).toHaveLength(1);
    // The requirements came from the brokerage's own templates, not from code.
    expect(db.tables["opportunity_requirements"]).toHaveLength(2);
    expect(db.tables["opportunity_requirements"]![0]!["label"]).toBe("Vehicle schedule with declared values");
    expect(db.tables["audit_log"]!.some((r) => r["action"] === "opportunity.created")).toBe(true);
  });

  it("submitted twice makes one opportunity", async () => {
    db.tables["opportunities"] = [];
    db.tables["opportunity_requirements"] = [];
    await start();
    await start();
    expect(db.tables["opportunities"]).toHaveLength(1);
    expect(db.tables["audit_log"]!.filter((r) => r["action"] === "opportunity.created")).toHaveLength(1);
  });

  it("refuses somebody whose role cannot start work", async () => {
    expect((await start({}, clerk)).status).toBe(403);
  });

  it("refuses a client of another brokerage", async () => {
    expect((await start({ clientId: "20000000-0000-4000-8000-0000000000ff" })).status).toBe(404);
  });
});

describe("the insurers being approached", () => {
  it("adds one, and a second click adds nothing", async () => {
    const r = await act({ action: "add_insurer", insurerId: INS_B });
    if (r.status !== 200) throw new Error(`${r.status} ${await r.text()}`);
    const first = await readJson(r);
    expect(first.outcome).toBe("done");
    expect(db.tables["opportunity_insurers"]).toHaveLength(2);

    const second = await readJson(await act({ action: "add_insurer", insurerId: INS_B }));
    expect(second.outcome).toBe("already");
    expect(db.tables["opportunity_insurers"]).toHaveLength(2);
  });

  it("refuses an insurer of another brokerage", async () => {
    const body = await readJson(await act({ action: "add_insurer", insurerId: "21000000-0000-4000-8000-0000000000ff" }));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/not in this brokerage/i);
  });

  it("keeps a removed insurer, with the reason", async () => {
    const body = await readJson(
      await act({ action: "remove_insurer", opportunityInsurerId: APPROACH_A, reason: "No appetite for this fleet." }),
    );
    expect(body.outcome).toBe("done");
    expect(db.tables["opportunity_insurers"]).toHaveLength(1);
    expect(db.tables["opportunity_insurers"]![0]!["removed_reason"]).toBe("No appetite for this fleet.");
  });
});

describe("requirements", () => {
  it("cannot be ticked without saying what proves it", async () => {
    const body = await readJson(
      await act({ action: "supply_requirement", requirementId: "33000000-0000-4000-8000-00000000000a" }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/document, an email, or a note/i);
  });

  it("is supplied when a person names the evidence", async () => {
    const body = await readJson(
      await act({
        action: "supply_requirement",
        requirementId: "33000000-0000-4000-8000-00000000000a",
        note: "Schedule handed over at the client meeting.",
      }),
    );
    expect(body.outcome).toBe("done");
    const req = body.opportunity.requirements[0];
    expect(req.suppliedAt).not.toBeNull();
    expect(req.evidence).toMatchObject({ kind: "note" });
  });
});

describe("preparing and approving a request", () => {
  const prepare = () =>
    act({
      action: "prepare_request",
      opportunityInsurerId: APPROACH_A,
      subject: "Quotation request — Acme Ltd",
      body: "We invite terms for commercial motor cover.",
    });

  it("prepares one, and preparing again replaces it rather than making a second", async () => {
    await prepare();
    await prepare();
    expect(db.tables["quote_requests"]).toHaveLength(1);
  });

  it("is prepared but not approved, and not sent", async () => {
    await prepare();
    const body = await read();
    const req = body.insurers[0].request;
    expect(req.preparedAt).not.toBeNull();
    expect(req.approvedAt).toBeNull();
    expect(req.sentAt).toBeNull();
  });

  it("approves it, once", async () => {
    await prepare();
    const id = db.tables["quote_requests"]![0]!["id"] as string;
    expect((await readJson(await act({ action: "approve_request", quoteRequestId: id }))).outcome).toBe("done");
    expect((await readJson(await act({ action: "approve_request", quoteRequestId: id }))).outcome).toBe("already");
    expect(db.tables["audit_log"]!.filter((r) => r["action"] === "opportunity.request_approved")).toHaveLength(1);
  });

  it("refuses to approve for somebody without that permission", async () => {
    await prepare();
    const id = db.tables["quote_requests"]![0]!["id"] as string;
    const body = await readJson(await act({ action: "approve_request", quoteRequestId: id }, clerk));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/may not approve/i);
  });

  it("clears the approval when the text is prepared again", async () => {
    await prepare();
    const id = db.tables["quote_requests"]![0]!["id"] as string;
    await act({ action: "approve_request", quoteRequestId: id });
    expect(db.tables["quote_requests"]![0]!["approved_at"]).not.toBeNull();

    await act({
      action: "prepare_request",
      opportunityInsurerId: APPROACH_A,
      subject: "Quotation request — Acme Ltd",
      body: "We invite terms for commercial motor cover. One change.",
    });
    expect(db.tables["quote_requests"]![0]!["approved_at"]).toBeNull();
  });

  it("never says a request was sent, and says why it cannot be", async () => {
    await prepare();
    const body = await read();
    expect(body.insurers[0].request.sentAt).toBeNull();
    expect(body.sending.available).toBe(false);
    expect(body.sending.reason).toMatch(/not connected yet/i);
  });
});

describe("recording what an insurer said", () => {
  it("refuses a quote that does not say where it came from", async () => {
    const body = await readJson(
      await act({ action: "record_response", opportunityInsurerId: APPROACH_A, outcome: "quoted" }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/where these terms came from/i);
    expect(db.tables["insurer_responses"]).toHaveLength(0);
  });

  it("records a quote that names its source", async () => {
    const body = await readJson(
      await act({
        action: "record_response",
        opportunityInsurerId: APPROACH_A,
        outcome: "quoted",
        premiumAmount: "5310000.00",
        premiumCurrency: "KES",
        sourceNote: "Terms read out by the underwriter by telephone.",
      }),
    );
    expect(body.outcome).toBe("done");
    const res = body.opportunity.insurers[0].response;
    expect(res).toMatchObject({ outcome: "quoted", premiumAmount: "5310000.00", premiumCurrency: "KES" });
    expect(res.source).toMatchObject({ kind: "note" });
    expect(res.receivedAt).not.toBeNull();
  });

  it("refuses a decline with no reason", async () => {
    const body = await readJson(
      await act({ action: "record_response", opportunityInsurerId: APPROACH_A, outcome: "declined" }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/has to say why/i);
  });

  it("records a decline with its reason", async () => {
    const body = await readJson(
      await act({
        action: "record_response",
        opportunityInsurerId: APPROACH_A,
        outcome: "declined",
        declineReason: "Outside their appetite for commercial fleets.",
      }),
    );
    expect(body.opportunity.insurers[0].response).toMatchObject({
      outcome: "declined",
      declineReason: "Outside their appetite for commercial fleets.",
    });
  });

  it("records silence as silence, carrying no premium and no time", async () => {
    await act({
      action: "record_response",
      opportunityInsurerId: APPROACH_A,
      outcome: "no_response",
      premiumAmount: "999.00",
      premiumCurrency: "KES",
    });
    const body = await read();
    expect(body.insurers[0].response).toMatchObject({
      outcome: "no_response",
      premiumAmount: null,
      receivedAt: null,
    });
  });

  it("recorded twice is one response, updated", async () => {
    const one = { action: "record_response", opportunityInsurerId: APPROACH_A, outcome: "quoted", sourceNote: "By telephone." };
    await act(one);
    await act({ ...one, premiumAmount: "1000.00", premiumCurrency: "KES" });
    expect(db.tables["insurer_responses"]).toHaveLength(1);
    expect((await read()).insurers[0].response.premiumAmount).toBe("1000.00");
  });
});

describe("terms", () => {
  async function quoted() {
    await act({
      action: "record_response",
      opportunityInsurerId: APPROACH_A,
      outcome: "quoted",
      sourceNote: "From the quotation slip.",
    });
    return db.tables["insurer_responses"]![0]!["id"] as string;
  }

  it("records a term, and the same term twice is one", async () => {
    const id = await quoted();
    await act({ action: "record_term", insurerResponseId: id, termType: "excess", label: "Own damage excess", extractedValue: "2.5% min 30,000" });
    const again = await readJson(
      await act({ action: "record_term", insurerResponseId: id, termType: "excess", label: "Own damage excess", extractedValue: "2.5% min 30,000" }),
    );
    expect(again.outcome).toBe("already");
    expect(db.tables["quote_terms"]).toHaveLength(1);
  });

  it("keeps what was extracted when a person corrects it", async () => {
    const id = await quoted();
    await act({ action: "record_term", insurerResponseId: id, termType: "excess", label: "Own damage excess", extractedValue: "2.5% min 30,000" });
    const termId = db.tables["quote_terms"]![0]!["id"] as string;

    const body = await readJson(await act({ action: "correct_term", termId, correctedValue: "2.5% min 35,000" }));
    expect(body.outcome).toBe("done");
    const term = body.opportunity.insurers[0].response.terms[0];
    // Both values survive: the difference between them is the audit.
    expect(term.extractedValue).toBe("2.5% min 30,000");
    expect(term.correctedValue).toBe("2.5% min 35,000");
    expect(term.correctedByName).toBe("Amina");
    expect(db.tables["audit_log"]!.some((r) => r["action"] === "opportunity.term_corrected")).toBe(true);
  });

  it("records an uncomparable wording as unclear rather than as a value", async () => {
    const id = await quoted();
    await act({ action: "record_term", insurerResponseId: id, termType: "excess", label: "Theft excess", unclear: true });
    const body = await read();
    expect(body.insurers[0].response.terms[0]).toMatchObject({ unclear: true, extractedValue: null });
  });
});

describe("closing", () => {
  it("records the outcome and the reason, once", async () => {
    expect((await readJson(await act({ action: "close", outcome: "lost", reason: "Client stayed with the incumbent." }))).outcome).toBe("done");
    expect((await readJson(await act({ action: "close", outcome: "lost", reason: "again" }))).outcome).toBe("already");
  });

  it("refuses further work once it is closed", async () => {
    await act({ action: "close", outcome: "placed", reason: "Placed with Insurer A." });
    const body = await readJson(await act({ action: "add_insurer", insurerId: INS_B }));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/closed/i);
  });
});

describe("permissions and isolation", () => {
  it("resolves what a person may do from the session", async () => {
    expect((await read()).permissions).toEqual({ canEdit: true, canApprove: true, canRecordResponse: true });
    expect((await read(OPP, clerk)).permissions).toEqual({ canEdit: false, canApprove: false, canRecordResponse: false });
  });

  it("blocks a change for somebody whose role carries nothing", async () => {
    const body = await readJson(await act({ action: "add_insurer", insurerId: INS_B }, clerk));
    expect(body.outcome).toBe("blocked");
    expect(db.tables["opportunity_insurers"]).toHaveLength(1);
  });

  it("never mixes another brokerage's records in", async () => {
    const body = await read();
    expect(JSON.stringify(body)).not.toMatch(/Not yours/);
  });
});

describe("the work layer stays separate", () => {
  it("reports the work item's own state, not a quotation word", async () => {
    const body = await read();
    expect(body.workItem).toMatchObject({ taskStatus: "needs_you" });
    // No status is stored on the opportunity at all.
    expect(body.opportunity).not.toHaveProperty("status");
    expect(body.opportunity).not.toHaveProperty("state");
  });
});
