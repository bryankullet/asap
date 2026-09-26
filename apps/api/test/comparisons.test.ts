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
      /* Minted by a database trigger in production (0051); written here because the stand-in
       * has no triggers, and a comparison cannot be generated without one. */
      insurer_response_revisions: [],
      quote_term_revisions: [],
      company_rules: [],
      documents: [],
      email_messages: [],
      audit_log: [],
    },
    defaults: {
      /* `version` is the database's, numbered by trigger (0051); the stand-in has none, so the
       * tests that care about a second version set it themselves. */
      quote_comparisons: { generated_at: iso, presented_at: null, presented_by: null, superseded_at: null, superseded_reason: null, version: 1 },
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

async function readVersion(version: number, token = "tok-amina") {
  const res = await build().request(`/opportunities/${OPP}/comparison?version=${version}`, {
    headers: asUser(token),
  });
  expect(res.status).toBe(200);
  return await readJson(res);
}

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
  mintRevisions();
}

/**
 * What the database does by trigger: one immutable revision per answer and per term, which is
 * what a comparison actually points at.
 */
function mintRevisions() {
  db.tables["insurer_response_revisions"] = (db.tables["insurer_responses"] ?? []).map((r, i) => ({
    id: `37000000-0000-4000-8000-00000000000${i}`,
    organization_id: ORG,
    insurer_response_id: r["id"],
    opportunity_id: OPP,
    revision: 1,
    outcome: r["outcome"],
    received_at: r["received_at"],
    premium_amount: r["premium_amount"],
    premium_currency: r["premium_currency"],
    valid_until: r["valid_until"],
    decline_reason: r["decline_reason"],
    source_document_id: r["source_document_id"],
    source_email_message_id: r["source_email_message_id"],
    source_note: r["source_note"],
    sha256: "0".repeat(64),
    created_at: iso,
  }));
  db.tables["quote_term_revisions"] = (db.tables["quote_terms"] ?? []).map((t, i) => ({
    id: `38000000-0000-4000-8000-00000000000${i}`,
    organization_id: ORG,
    quote_term_id: t["id"],
    insurer_response_id: t["insurer_response_id"],
    revision: 1,
    term_type: t["term_type"],
    label: t["label"],
    extracted_value: t["extracted_value"],
    corrected_value: t["corrected_value"],
    corrected_by: t["corrected_by"],
    corrected_at: t["corrected_at"],
    amount: t["amount"],
    currency: t["currency"],
    unclear: t["unclear"],
    evidence_document_id: t["evidence_document_id"],
    evidence_page: t["evidence_page"],
    region_x: null,
    region_y: null,
    region_width: null,
    region_height: null,
    sha256: "0".repeat(64),
    created_at: iso,
  }));
}

/** A brokerage saying when ASAP may name a recommended quote. Their number, their reason. */
function setRule(value: unknown, source = "Partners meeting, 4 September 2026.") {
  db.tables["company_rules"] = [
    {
      id: "39000000-0000-4000-8000-00000000000a",
      organization_id: ORG,
      key: "quote.recommendation",
      value,
      source,
      verified_at: "2026-09-04",
      note: null,
      set_by: AMINA.id,
      created_at: iso,
      updated_at: iso,
    },
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
  /*
   * The correction 4B-3A exists for. 4B-3 named a recommended insurer whenever the premiums were
   * more than 5% apart — a number from nowhere, deciding something no constant is entitled to
   * decide. Which insurer a client should be advised to take is the broker's judgement, and ASAP
   * enters it only where the brokerage has written down when it may.
   */

  it("states the facts and names nobody when no rule is configured", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.rule).toBeNull();
    expect(r.headline).toBe("ASAP is not recommending one of these.");
    expect(r.reasoning.join(" ")).toMatch(/No rule has been set/);
    expect(r.reasoning.join(" ")).toMatch(/judgement for the broker/);
    /* But the difference itself is stated plainly, in shillings. */
    expect(r.facts.join(" ")).toMatch(/Jubilee is KES 310,000 cheaper than CIC — 5\.5%/);
  });

  it("honours a brokerage that has asked it not to recommend", async () => {
    twoQuotes();
    setRule({ mode: "abstain" }, "Partners decided advice stays with the broker.");
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.headline).toMatch(/asked ASAP not to recommend/);
    expect(r.rule?.source).toBe("Partners decided advice stays with the broker.");
  });

  it("recommends under the brokerage's own rule, and says it is theirs", async () => {
    twoQuotes();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 5 });
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBe(INS_A);
    expect(r.headline).toBe("Jubilee, under this brokerage's own rule.");
    expect(r.reasoning.join(" ")).toMatch(/at or above the 5% this brokerage set/);
    expect(r.reasoning.join(" ")).toMatch(/the broker's judgement/);
    expect(r.rule?.verifiedAt).toBe("2026-09-04");
  });

  it("gives two brokerages different answers on the same quotes", async () => {
    twoQuotes();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 5 });
    await act({ action: "generate_comparison" });
    const lenient = (await read()).comparison.recommendation;

    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 12 }, "Their own policy.");
    const strict = (await read()).comparison.recommendation;

    expect(lenient.insurerId).toBe(INS_A);
    expect(strict.insurerId).toBeNull();
    expect(strict.reasoning.join(" ")).toMatch(/asks for at least 12%, and the gap is 5\.5%/);
  });

  it("recommending records no choice of insurer anywhere", async () => {
    twoQuotes();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 5 });
    await act({ action: "generate_comparison" });
    expect((await read()).comparison.recommendation.insurerId).toBe(INS_A);

    /* A recommendation is not a placement. Nothing in the book may record a selection for it. */
    const written = JSON.stringify(db.tables["opportunities"]) + JSON.stringify(db.tables["opportunity_insurers"]);
    expect(written).not.toMatch(/selected|chosen|placed_with/);
    expect(db.tables["opportunities"]![0]!["closed_outcome"]).toBeNull();
    expect(db.tables["audit_log"]!.every((r) => !String(r["action"]).includes("placed"))).toBe(true);
  });

  it("will not apply a rule to quotes that are not like for like", async () => {
    twoQuotes();
    db.tables["quote_terms"] = [term("35000000-0000-4000-8000-00000000000a", RESP_A, "Theft excess", "10% of claim")];
    mintRevisions();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 5 });
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.headline).toMatch(/not yet like for like/);
    expect(r.facts.join(" ")).toMatch(/CIC did not state Theft excess/);
  });

  it("will not apply a rule to a term that cannot be compared", async () => {
    twoQuotes();
    db.tables["quote_terms"]![1]!["unclear"] = true;
    db.tables["quote_terms"]![1]!["extracted_value"] = "As per policy wording";
    mintRevisions();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: 5 });
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/CIC: Own damage was stated in terms that cannot be compared/);
  });

  it("says nothing about price when fewer than two quotes carry a premium", async () => {
    twoQuotes("5310000.00", null);
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.caveats[0]).toMatch(/Fewer than two of these quotes state a premium/);
  });

  it("ignores a rule that does not parse rather than inventing one", async () => {
    twoQuotes();
    setRule({ mode: "cheapest_when_like_for_like", minimumGapPercent: "quite a lot" });
    await act({ action: "generate_comparison" });

    const r = (await read()).comparison.recommendation;
    expect(r.insurerId).toBeNull();
    expect(r.rule).toBeNull();
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


describe("what the client was shown", () => {
  /*
   * The 4B-3A correction. A comparison joined to live rows shows today's excess under last
   * month's name; these hold it to the revisions it actually compared.
   */

  it("shows the values it compared, not the values as they stand now", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });

    /* The insurer revises, and a person corrects a misread excess. */
    db.tables["insurer_responses"]![0]!["premium_amount"] = "5410000.00";
    db.tables["insurer_responses"]![0]!["valid_until"] = "2028-03-31";
    db.tables["quote_terms"]![0]!["corrected_value"] = "5% min KES 50,000";
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed its quote after this comparison was made.";

    const body = await read();
    const old = body.history[0];
    expect(old.version).toBe(1);

    const shown = await readVersion(1);
    /* Superseded, so reading it is reading history — which is exactly what it should say. */
    expect(shown.viewingHistory).toBe(true);
    const jubilee = shown.comparison.columns.find((c: { insurerName: string }) => c.insurerName === "Jubilee");
    expect(jubilee.premiumAmount).toBe("5310000.00");
    expect(jubilee.validUntil).toBe(VALID_UNTIL);

    const row = shown.comparison.rows[0];
    const cell = row.cells.find((c: { insurerId: string }) => c.insurerId === INS_A);
    expect(cell.value).toBe("5% min KES 30,000");
  });

  it("says what moved, old value to new value", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    db.tables["insurer_responses"]![0]!["premium_amount"] = "5410000.00";
    db.tables["quote_terms"]![0]!["corrected_value"] = "5% min KES 50,000";

    const changed = (await read()).comparison.changedValues;
    const premium = changed.find((c: { label: string }) => c.label === "Premium");
    expect(premium).toMatchObject({ insurerName: "Jubilee", was: "KES 5,310,000", now: "KES 5,410,000" });
    const excess = changed.find((c: { label: string }) => c.label === "Own damage");
    expect(excess).toMatchObject({ was: "5% min KES 30,000", now: "5% min KES 50,000" });
  });

  it("opens an earlier version as it was, beside the current one", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed its quote.";
    db.tables["quote_comparisons"]![0]!["version"] = 1;

    db.tables["quote_terms"]![0]!["corrected_value"] = "5% min KES 50,000";
    mintRevisions();
    db.tables["quote_term_revisions"]![0]!["id"] = "38000000-0000-4000-8000-0000000000ff";
    db.tables["quote_term_revisions"]![0]!["revision"] = 2;
    db.tables["quote_term_revisions"]!.push({
      ...db.tables["quote_term_revisions"]![0]!,
      id: "38000000-0000-4000-8000-000000000000",
      revision: 1,
      corrected_value: null,
      extracted_value: "5% min KES 30,000",
    });

    await act({ action: "generate_comparison" });
    db.tables["quote_comparisons"]![1]!["version"] = 2;

    const now = await read();
    expect(now.comparison.version).toBe(2);
    expect(now.viewingHistory).toBe(false);
    const nowCell = now.comparison.rows[0].cells.find((c: { insurerId: string }) => c.insurerId === INS_A);
    expect(nowCell.value).toBe("5% min KES 50,000");

    const then = await readVersion(1);
    expect(then.viewingHistory).toBe(true);
    expect(then.comparison.version).toBe(1);
    const thenCell = then.comparison.rows[0].cells.find((c: { insurerId: string }) => c.insurerId === INS_A);
    expect(thenCell.value).toBe("5% min KES 30,000");
  });

  it("carries the page a figure was read from into the old comparison's citation", async () => {
    twoQuotes();
    mintRevisions();
    db.tables["quote_term_revisions"]![0]!["evidence_document_id"] = "3a000000-0000-4000-8000-00000000000a";
    db.tables["quote_term_revisions"]![0]!["evidence_page"] = 3;
    await act({ action: "generate_comparison" });

    const cell = (await read()).comparison.rows[0].cells.find(
      (c: { insurerId: string }) => c.insurerId === INS_A,
    );
    expect(cell.evidence.path).toBe("/documents/3a000000-0000-4000-8000-00000000000a");
    expect(cell.evidence.label).toMatch(/page 3/);
  });
});

describe("how long a quote holds", () => {
  it("says a quote has expired, and refuses to let it go to a client", async () => {
    twoQuotes();
    db.tables["insurer_responses"]![0]!["valid_until"] = "2026-01-01";
    mintRevisions();
    await act({ action: "generate_comparison" });

    const body = await read();
    const jubilee = body.comparison.columns.find((c: { insurerName: string }) => c.insurerName === "Jubilee");
    expect(jubilee.validity.state).toBe("expired");
    expect(body.comparison.presentable.can).toBe(false);
    expect(body.comparison.presentable.reason).toMatch(/expired quotation is not an offer/);

    const refused = await readJson(
      await act({ action: "present_comparison", comparisonId: body.comparison.id }),
    );
    expect(refused.outcome).toBe("blocked");
    expect(refused.reason).toMatch(/expired/);
  });

  it("says when a quote states no validity at all", async () => {
    twoQuotes();
    db.tables["insurer_responses"]![0]!["valid_until"] = null;
    mintRevisions();
    await act({ action: "generate_comparison" });

    const jubilee = (await read()).comparison.columns.find(
      (c: { insurerName: string }) => c.insurerName === "Jubilee",
    );
    expect(jubilee.validity.state).toBe("not_stated");
    expect(jubilee.validity.note).toMatch(/did not say how long/);
  });

  it("names the threshold's basis rather than hiding the number", async () => {
    twoQuotes();
    await act({ action: "generate_comparison" });
    const column = (await read()).comparison.columns[0];
    expect(column.validity.thresholdDays).toBe(14);
    expect(column.validity.thresholdSource).toMatch(/ASAP's default of 14 days/);

    db.tables["company_rules"] = [
      {
        id: "39000000-0000-4000-8000-00000000000b",
        organization_id: ORG,
        key: "quote.validity",
        value: { expiringSoonDays: 30 },
        source: "Their underwriting manual, clause 4.",
        verified_at: "2026-08-01",
        note: null,
        set_by: AMINA.id,
        created_at: iso,
        updated_at: iso,
      },
    ];
    const withRule = (await read()).comparison.columns[0];
    expect(withRule.validity.thresholdDays).toBe(30);
    expect(withRule.validity.thresholdSource).toMatch(/underwriting manual, clause 4/);
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
