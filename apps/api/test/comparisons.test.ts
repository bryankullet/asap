/**
 * Lining the quotes up beside each other (4B-3).
 *
 * What these lock is that a comparison cannot mislead:
 *   - it is not offered until there are two quotes to compare, and it says what is outstanding;
 *   - an insurer that said nothing about a term shows as silent, never as a blank cell;
 *   - the cheapest quote does not win by being cheapest, and a close race abstains;
 *   - quotes that are not like-for-like produce no recommendation at all;
 *   - a stale comparison cannot be presented to a client;
 *   - generating again keeps the old one;
 *   - and permissions come from the session.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLERK = { id: "a0000000-0000-4000-8000-000000000002", email: "clerk@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";

const CLIENT = "20000000-0000-4000-8000-00000000000a";
const WORK = "26000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const INS_B = "21000000-0000-4000-8000-00000000000b";
const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
const APPROACH_B = "31000000-0000-4000-8000-00000000000b";
const RESP_A = "34000000-0000-4000-8000-00000000000a";
const RESP_B = "34000000-0000-4000-8000-00000000000b";
const iso = "2026-09-05T09:00:00.000Z";
/* Far enough out that the validity note does not fire and clutter every recommendation. */
const VALID_UNTIL = "2027-12-31";

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

function response(id: string, approachId: string, premium: string | null) {
  return {
    id,
    organization_id: ORG,
    opportunity_id: OPP,
    opportunity_insurer_id: approachId,
    outcome: "quoted",
    received_at: iso,
    source_note: "Quotation letter received by email.",
    source_document_id: null,
    source_email_message_id: null,
    premium_amount: premium,
    premium_currency: premium === null ? null : "KES",
    valid_until: VALID_UNTIL,
    decline_reason: null,
    recorded_by: AMINA.id,
    recorded_at: iso,
  };
}

function term(id: string, responseId: string, label: string, value: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    insurer_response_id: responseId,
    term_type: "excess",
    label,
    extracted_value: value,
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    amount: null,
    currency: null,
    unclear: false,
    evidence_document_id: null,
    evidence_page: null,
    position: 0,
    created_at: iso,
    ...extra,
  };
}

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-clerk": CLERK },
    inserts: [],
    rpc: {
      /* The database's own answer to "what has moved". Empty unless a test says otherwise. */
      quote_comparison_changes: () => ({ data: [] }),
    },
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: CLERK.id, email: CLERK.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(CLERK.id, READONLY_ROLE)],
      role_permissions: [{ role_id: ADMIN_ROLE, permission: { object_type: "space", verb: "create" } }],
      clients: [
        { id: CLIENT, organization_id: ORG, name: "Acme Ltd", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null },
      ],
      insurers: [
        { id: INS_A, organization_id: ORG, name: "Jubilee" },
        { id: INS_B, organization_id: ORG, name: "CIC" },
      ],
      work_items: [
        { id: WORK, organization_id: ORG, client_id: CLIENT, kind: "new_business", title: "Fleet quotation — 2027", task_status: "needs_you", task_party: null, task_since: null, created_at: iso, deleted_at: null },
      ],
      requirement_templates: [],
      opportunities: [
        { id: OPP, organization_id: ORG, client_id: CLIENT, work_item_id: WORK, title: "Acme motor fleet quotation — 2027", class_of_business: "Commercial motor", risk_summary: "Five commercial vehicles", cover_start: "2027-01-01", cover_end: "2027-12-31", source_email_message_id: null, source_document_id: null, owner_id: AMINA.id, created_by: AMINA.id, created_at: iso, closed_at: null, closed_outcome: null, closed_reason: null },
      ],
      opportunity_requirements: [],
      opportunity_insurers: [
        { id: APPROACH_A, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
        { id: APPROACH_B, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_B, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
      ],
      quote_requests: [],
      insurer_responses: [],
      quote_terms: [],
      quote_comparisons: [],
      quote_comparison_inputs: [],
      quote_comparison_terms: [],
      documents: [],
      email_messages: [],
      audit_log: [],
    },
    defaults: {
      quote_comparisons: { generated_at: iso, presented_at: null, presented_by: null, superseded_at: null, superseded_reason: null },
      quote_comparison_inputs: { created_at: iso },
      quote_comparison_terms: { quote_term_id: null },
      opportunity_insurers: { added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
      quote_requests: { prepared_at: iso, approved_at: null, approved_by: null, approved_body_sha256: null, sent_at: null, sent_email_message_id: null },
      insurer_responses: { recorded_at: iso, received_at: null, premium_amount: null, premium_currency: null, valid_until: null, decline_reason: null, source_note: null, source_document_id: null, source_email_message_id: null },
      quote_terms: { position: 0, unclear: false, extracted_value: null, corrected_value: null, corrected_by: null, corrected_at: null, amount: null, currency: null, evidence_document_id: null, evidence_page: null },
      opportunities: { closed_at: null, closed_outcome: null, closed_reason: null },
    },
    uniques: {
      quote_comparison_inputs: [["comparison_id", "insurer_response_id"]],
      quote_comparison_terms: [["comparison_input_id", "term_type", "label"]],
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

const asUser = (token = "tok-amina") => ({ authorization: `Bearer ${token}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

async function read(token = "tok-amina") {
  const res = await build().request(`/opportunities/${OPP}/comparison`, { headers: asUser(token) });
  expect(res.status).toBe(200);
  return await readJson(res);
}

async function act(body: unknown, token = "tok-amina") {
  return await build().request(`/opportunities/${OPP}/comparison/actions`, {
    method: "POST",
    headers: { ...asUser(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Two insurers, both quoted, with the same excess stated by both. Like for like. */
function twoQuotes(premiumA: string | null = "5310000.00", premiumB: string | null = "5620000.00") {
  db.tables["insurer_responses"] = [response(RESP_A, APPROACH_A, premiumA), response(RESP_B, APPROACH_B, premiumB)];
  db.tables["quote_terms"] = [
    term("35000000-0000-4000-8000-00000000000a", RESP_A, "Own damage", "5% min KES 30,000"),
    term("35000000-0000-4000-8000-00000000000b", RESP_B, "Own damage", "5% min KES 25,000"),
  ];
}

describe("whether there is anything to compare", () => {
  it("says nothing has been quoted, and names who has not answered", async () => {
    const body = await read();
    expect(body.readiness.ready).toBe(false);
    expect(body.comparison).toBeNull();
    expect(body.readiness.blockers[0]).toMatch(/No insurer has quoted yet/);
    /* Never a bare "Waiting": the outstanding insurers are named, with a date. */
    expect(body.readiness.awaiting.map((a: { insurerName: string }) => a.insurerName).sort()).toEqual(["CIC", "Jubilee"]);
    expect(body.readiness.blockers.join(" ")).not.toMatch(/\bWaiting\b/);
  });

  it("says one quote is not a comparison", async () => {
    db.tables["insurer_responses"] = [response(RESP_A, APPROACH_A, "5310000.00")];
    const body = await read();
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.quoted).toBe(1);
    expect(body.readiness.blockers.join(" ")).toMatch(/Jubilee has quoted\. One quote is a quote, not a comparison/);
  });

  it("refuses to generate one before there is anything to compare", async () => {
    const body = await readJson(await act({ action: "generate_comparison" }));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/nothing to compare/);
  });

  it("is ready once two insurers have quoted, and still names the outstanding papers", async () => {
    twoQuotes();
    db.tables["opportunity_requirements"] = [
      { id: "33000000-0000-4000-8000-00000000000a", organization_id: ORG, opportunity_id: OPP, label: "the claims history", required: true, position: 0, supplied_at: null, supplied_by: null, evidence_document_id: null, evidence_email_message_id: null, evidence_note: null },
    ];
    const body = await read();
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.missingInformation).toEqual(["the claims history"]);
    expect(body.readiness.blockers.join(" ")).toMatch(/has not supplied the claims history/);
  });
});

describe("the comparison itself", () => {
  it("records what it compared and lines the terms up", async () => {
    twoQuotes();
    expect((await readJson(await act({ action: "generate_comparison" }))).outcome).toBe("done");

    const body = await read();
    expect(body.comparison.columns.map((c: { insurerName: string }) => c.insurerName)).toEqual(["CIC", "Jubilee"]);
    expect(body.comparison.rows).toHaveLength(1);
    expect(body.comparison.rows[0].label).toBe("Own damage");
    expect(body.comparison.rows[0].incomplete).toBe(false);
    /* The digests of exactly these rows are what the database watches for change. */
    expect(db.tables["quote_comparison_inputs"]).toHaveLength(2);
    expect(db.tables["quote_comparison_terms"]).toHaveLength(2);
  });

  it("shows an unstated term as silence, not as a blank", async () => {
    twoQuotes();
    db.tables["quote_terms"] = [term("35000000-0000-4000-8000-00000000000a", RESP_A, "Theft excess", "10% of claim")];
    await act({ action: "generate_comparison" });

    const row = (await read()).comparison.rows[0];
    const cic = row.cells.find((cell: { insurerId: string }) => cell.insurerId === INS_B);
    expect(cic.missing).toBe(true);
    expect(cic.value).toBeNull();
    expect(row.incomplete).toBe(true);
  });

  it("does not make a second photograph of an unchanged market", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    expect((await readJson(await act({ action: "generate_comparison" }))).outcome).toBe("already");
    expect(db.tables["quote_comparisons"]).toHaveLength(1);
  });

  it("keeps the old comparison when a new one is generated", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed its quote after this comparison was made.";

    expect((await readJson(await act({ action: "generate_comparison" }))).outcome).toBe("done");
    expect(db.tables["quote_comparisons"]).toHaveLength(2);

    const body = await read();
    expect(body.history).toHaveLength(1);
    expect(body.history[0].supersededReason).toMatch(/Jubilee changed its quote/);
  });
});

describe("what it recommends, and when it declines to", () => {
  it("does not call the cheapest quote best when they are close", async () => {
    twoQuotes("5310000.00", "5400000.00");
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.headline).toMatch(/price should not decide it/);
    expect(r.reasoning.join(" ")).toMatch(/Cover and excesses will matter more/);
  });

  it("abstains when the quotes are not like for like, and says which term is missing", async () => {
    twoQuotes();
    db.tables["quote_terms"] = [term("35000000-0000-4000-8000-00000000000a", RESP_A, "Theft excess", "10% of claim")];
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.headline).toMatch(/not yet like for like/);
    expect(r.caveats.join(" ")).toMatch(/CIC did not state Theft excess/);
  });

  it("abstains when an insurer said something that cannot be compared", async () => {
    twoQuotes();
    db.tables["quote_terms"]![1]!["unclear"] = true;
    db.tables["quote_terms"]![1]!["extracted_value"] = "As per policy wording";
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/CIC: Own damage was stated in terms that cannot be compared/);
  });

  it("recommends only when the same cover is priced twice, and says why", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBe(INS_A);
    expect(r.headline).toBe("Jubilee on these terms.");
    expect(r.reasoning.join(" ")).toMatch(/same cover priced twice/);
    expect(r.reasoning[0]).toMatch(/Jubilee quotes KES 5,310,000/);
  });

  it("says nothing when fewer than two quotes carry a premium", async () => {
    twoQuotes("5310000.00", null);
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.caveats[0]).toMatch(/Fewer than two of these quotes state a premium/);
  });
});

describe("staleness and presentation", () => {
  it("reports what the database noticed, naming the insurer and the term", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed the term \"Own damage\" after this comparison was made.";
    db.rpc["quote_comparison_changes"] = () => ({
      data: [{ insurer_id: INS_A, insurer_name: "Jubilee", term_type: "excess", label: "Own damage", change: "This term changed." }],
    });

    /* A superseded comparison is history, and the Space says so rather than showing it as live. */
    const body = await read();
    expect(body.comparison).toBeNull();
    expect(body.history[0].supersededReason).toMatch(/Own damage/);
  });

  it("refuses to present a stale comparison", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    const id = db.tables["quote_comparisons"]![0]!["id"] as string;
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed its quote after this comparison was made.";

    const body = await readJson(await act({ action: "present_comparison", comparisonId: id }));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/no longer the current one/);
  });

  it("records presenting a current one, once", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    const id = db.tables["quote_comparisons"]![0]!["id"] as string;

    expect((await readJson(await act({ action: "present_comparison", comparisonId: id }))).outcome).toBe("done");
    expect((await readJson(await act({ action: "present_comparison", comparisonId: id }))).outcome).toBe("already");
    expect(db.tables["audit_log"]!.filter((r) => r["action"] === "opportunity.comparison_presented")).toHaveLength(1);
  });
});

describe("who may do it", () => {
  it("refuses somebody without the permission, and says so on the reading too", async () => {
    twoQuotes();
    const body = await read("tok-clerk");
    expect(body.permissions.canGenerate).toBe(false);

    const refused = await readJson(await act({ action: "generate_comparison" }, "tok-clerk"));
    expect(refused.outcome).toBe("blocked");
    expect(refused.reason).toMatch(/may not change this quotation work/);
  });
});
