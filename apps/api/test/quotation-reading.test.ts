/**
 * Reading a quotation, and the review between reading it and believing it (4B-3A).
 *
 * The failures these guard against are the ones that put an insurer's misread excess in front of
 * a client without anybody deciding it should be there:
 *
 *   - a proposal is never a term until a person accepts or corrects it;
 *   - a correction is preserved beside what was read, never instead of it;
 *   - a quotation is linked to an insurer's answer by a person, never by name likeness;
 *   - a document on one client's file cannot be applied to another client's quotation;
 *   - the same document cannot be applied to two answers;
 *   - a second decision on the same proposal changes nothing;
 *   - a later reading cannot overwrite a human correction;
 *   - and one brokerage reaches none of another's.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { extractDocument } from "../src/documents/extraction.js";
import { scriptedExtractor, type ExtractionResult } from "../src/documents/extractor.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLERK = { id: "a0000000-0000-4000-8000-000000000002", email: "clerk@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";

const CLIENT = "20000000-0000-4000-8000-00000000000a";
const OTHER_CLIENT = "20000000-0000-4000-8000-00000000000b";
const WORK = "26000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
const RESP_A = "34000000-0000-4000-8000-00000000000a";
const DOC = "3a000000-0000-4000-8000-00000000000a";
const OTHER_DOC = "3a000000-0000-4000-8000-00000000000b";
const THEIR_DOC = "3a000000-0000-4000-8000-0000000000ff";
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

function proposal(id: string, ordinal: number, over: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    document_id: DOC,
    ordinal,
    term_type: "excess",
    label: `Excess ${ordinal}`,
    proposed_value: "5% of claim, minimum KES 30,000",
    amount: "30000.00",
    currency: "KES",
    page_number: 1,
    region_x: "50",
    region_y: "120",
    region_width: "300",
    region_height: "12",
    condition: "known",
    method: "labelled_line",
    state: "proposed",
    corrected_value: null,
    corrected_amount: null,
    reviewed_by: null,
    reviewed_at: null,
    quote_term_id: null,
    previous_revision_id: null,
    created_at: iso,
    ...over,
  };
}

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-clerk": CLERK },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: CLERK.id, email: CLERK.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(CLERK.id, READONLY_ROLE)],
      role_permissions: [
        { role_id: ADMIN_ROLE, permission: { object_type: "document", verb: "edit" } },
        { role_id: ADMIN_ROLE, permission: { object_type: "space", verb: "create" } },
      ],
      clients: [
        { id: CLIENT, organization_id: ORG, name: "Acme Ltd", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null },
        { id: OTHER_CLIENT, organization_id: ORG, name: "Bluewave Ltd", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null },
      ],
      insurers: [{ id: INS_A, organization_id: ORG, name: "Jubilee" }],
      work_items: [
        { id: WORK, organization_id: ORG, client_id: CLIENT, kind: "new_business", title: "Fleet", task_status: "needs_you", created_at: iso, deleted_at: null },
      ],
      opportunities: [
        { id: OPP, organization_id: ORG, client_id: CLIENT, work_item_id: WORK, title: "Acme motor fleet quotation — 2027", class_of_business: "Commercial motor", created_by: AMINA.id, created_at: iso, closed_at: null },
      ],
      opportunity_insurers: [
        { id: APPROACH_A, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A, added_by: AMINA.id, added_at: iso, removed_at: null },
      ],
      insurer_responses: [
        { id: RESP_A, organization_id: ORG, opportunity_id: OPP, opportunity_insurer_id: APPROACH_A, outcome: "quoted", received_at: iso, source_note: "By email.", source_document_id: null, source_email_message_id: null, premium_amount: "5310000.00", premium_currency: "KES", valid_until: "2027-12-31", decline_reason: null, recorded_by: AMINA.id, recorded_at: iso },
      ],
      documents: [
        { id: DOC, organization_id: ORG, client_id: CLIENT, filename: "jubilee-quotation.pdf", storage_path: "org/q.pdf", mime_type: "application/pdf", byte_size: 2048, content_sha256: "a".repeat(64), kind: "other", page_count: 2, extraction_state: "extracted", extraction_error: null, uploaded_by: AMINA.id, created_at: iso, deleted_at: null },
        { id: OTHER_DOC, organization_id: ORG, client_id: OTHER_CLIENT, filename: "bluewave-quotation.pdf", storage_path: "org/b.pdf", mime_type: "application/pdf", byte_size: 2048, content_sha256: "b".repeat(64), kind: "other", page_count: 1, extraction_state: "extracted", extraction_error: null, uploaded_by: AMINA.id, created_at: iso, deleted_at: null },
        { id: THEIR_DOC, organization_id: OTHER_ORG, client_id: "20000000-0000-4000-8000-0000000000ff", filename: "not-yours.pdf", storage_path: "other/q.pdf", mime_type: "application/pdf", byte_size: 10, content_sha256: "c".repeat(64), kind: "other", page_count: 1, extraction_state: "extracted", extraction_error: null, uploaded_by: "b0000000-0000-4000-8000-000000000001", created_at: iso, deleted_at: null },
      ],
      document_fields: [
        { id: "3b000000-0000-4000-8000-00000000000a", organization_id: ORG, document_id: DOC, field_key: "premium", proposed_value: "KES 5,310,000", corrected_value: null, page_number: 1, condition: "known", state: "proposed" },
      ],
      document_term_proposals: [
        proposal("3c000000-0000-4000-8000-00000000000a", 0),
        proposal("3c000000-0000-4000-8000-00000000000b", 1, { label: "Theft excess", proposed_value: "As per policy wording", amount: null, currency: null, condition: "unclear" }),
      ],
      quote_terms: [],
      quote_term_revisions: [],
      audit_log: [],
    },
    defaults: {
      quote_terms: { position: 0, unclear: false, extracted_value: null, corrected_value: null, corrected_by: null, corrected_at: null, amount: null, currency: null, evidence_document_id: null, evidence_page: null, region_x: null, region_y: null, region_width: null, region_height: null, created_at: iso },
      insurer_responses: { source_document_id: null },
    },
    uniques: {
      quote_terms: [["insurer_response_id", "term_type", "label"]],
      insurer_responses: [["organization_id", "source_document_id"]],
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

async function read(documentId = DOC, token = "tok-amina") {
  const res = await build().request(`/documents/${documentId}/quotation`, { headers: asUser(token) });
  return { status: res.status, body: res.status === 200 ? await readJson(res) : null };
}

async function act(body: unknown, documentId = DOC, token = "tok-amina") {
  return await build().request(`/documents/${documentId}/quotation/actions`, {
    method: "POST",
    headers: { ...asUser(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const link = () => act({ action: "link_to_response", documentId: DOC, insurerResponseId: RESP_A });

describe("what was read", () => {
  it("returns every proposal separately, with its page and rectangle", async () => {
    const { body } = await read();
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0].region).toEqual({ x: 50, y: 120, width: 300, height: 12 });
    expect(body.proposals[0].page).toBe(1);
    expect(body.proposals.every((p: { state: string }) => p.state === "proposed")).toBe(true);
  });

  it("says a document needs a person when it could not be read", async () => {
    db.tables["documents"]![0]!["extraction_error"] =
      "This document has no readable text. It is most likely a scan, and ASAP cannot read scanned documents yet — the terms have to be entered by hand.";
    const { body } = await read();
    expect(body.needsManualReview).toMatch(/cannot read scanned documents yet/);
  });

  it("is not reachable for another brokerage's document", async () => {
    expect((await read(THEIR_DOC)).status).toBe(404);
  });
});

describe("choosing which answer a quotation is", () => {
  it("records the link a person chose", async () => {
    expect((await readJson(await link())).outcome).toBe("done");
    expect(db.tables["insurer_responses"]![0]!["source_document_id"]).toBe(DOC);
    const { body } = await read();
    expect(body.linkedTo.insurerName).toBe("Jubilee");
  });

  it("is idempotent", async () => {
    await link();
    expect((await readJson(await link())).outcome).toBe("already");
  });

  it("refuses a document that belongs to another client's file", async () => {
    const body = await readJson(
      await act({ action: "link_to_response", documentId: OTHER_DOC, insurerResponseId: RESP_A }, OTHER_DOC),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/different client's file/);
  });

  it("refuses an answer from another brokerage", async () => {
    db.tables["insurer_responses"]!.push({
      ...db.tables["insurer_responses"]![0]!,
      id: "34000000-0000-4000-8000-0000000000ff",
      organization_id: OTHER_ORG,
      source_document_id: null,
    });
    const body = await readJson(
      await act({
        action: "link_to_response",
        documentId: DOC,
        insurerResponseId: "34000000-0000-4000-8000-0000000000ff",
      }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/not part of this brokerage/);
  });

  it("refuses to apply one document to a second answer", async () => {
    await link();
    db.tables["opportunity_insurers"]!.push({
      id: "31000000-0000-4000-8000-00000000000b",
      organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A,
      added_by: AMINA.id, added_at: iso, removed_at: null,
    });
    db.tables["insurer_responses"]!.push({
      ...db.tables["insurer_responses"]![0]!,
      id: "34000000-0000-4000-8000-00000000000b",
      opportunity_insurer_id: "31000000-0000-4000-8000-00000000000b",
      source_document_id: null,
    });

    const body = await readJson(
      await act({
        action: "link_to_response",
        documentId: DOC,
        insurerResponseId: "34000000-0000-4000-8000-00000000000b",
      }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/already the source for another insurer's answer/);
  });
});

describe("reviewing what was read", () => {
  it("will not confirm a term before the answer has been chosen", async () => {
    const body = await readJson(
      await act({ action: "accept_proposal", proposalId: "3c000000-0000-4000-8000-00000000000a" }),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/Choose which insurer's answer/);
    expect(db.tables["quote_terms"]).toHaveLength(0);
  });

  it("accepting writes the confirmed term, with its page and rectangle", async () => {
    await link();
    expect(
      (await readJson(await act({ action: "accept_proposal", proposalId: "3c000000-0000-4000-8000-00000000000a" })))
        .outcome,
    ).toBe("done");

    const term = db.tables["quote_terms"]![0]!;
    expect(term["label"]).toBe("Excess 0");
    expect(term["extracted_value"]).toBe("5% of claim, minimum KES 30,000");
    expect(term["corrected_value"]).toBeNull();
    expect(term["evidence_document_id"]).toBe(DOC);
    expect(term["evidence_page"]).toBe(1);
    expect(term["region_y"]).toBe("120");
  });

  it("correcting keeps what was read beside what a person says it is", async () => {
    await link();
    const body = await readJson(
      await act({
        action: "correct_proposal",
        proposalId: "3c000000-0000-4000-8000-00000000000a",
        correctedValue: "5% of claim, minimum KES 50,000",
      }),
    );
    expect(body.outcome).toBe("done");

    const term = db.tables["quote_terms"]![0]!;
    /* The extractor's reading survives the correction. Both are on the record. */
    expect(term["extracted_value"]).toBe("5% of claim, minimum KES 30,000");
    expect(term["corrected_value"]).toBe("5% of claim, minimum KES 50,000");
    expect(term["corrected_by"]).toBe(AMINA.id);

    const proposalRow = db.tables["document_term_proposals"]![0]!;
    expect(proposalRow["state"]).toBe("corrected");
    expect(proposalRow["reviewed_by"]).toBe(AMINA.id);
  });

  it("rejecting records the decision and writes no term", async () => {
    await link();
    const body = await readJson(
      await act({ action: "reject_proposal", proposalId: "3c000000-0000-4000-8000-00000000000b" }),
    );
    expect(body.outcome).toBe("done");
    expect(db.tables["quote_terms"]).toHaveLength(0);
    expect(db.tables["document_term_proposals"]![1]!["state"]).toBe("rejected");
    expect(db.tables["document_term_proposals"]![1]!["quote_term_id"]).toBeNull();
  });

  it("does not decide the same proposal twice", async () => {
    await link();
    await act({ action: "accept_proposal", proposalId: "3c000000-0000-4000-8000-00000000000a" });
    expect(
      (await readJson(await act({ action: "accept_proposal", proposalId: "3c000000-0000-4000-8000-00000000000a" })))
        .outcome,
    ).toBe("already");
    expect(db.tables["quote_terms"]).toHaveLength(1);
  });

  it("keeps no value from the document in the audit trail", async () => {
    await link();
    await act({
      action: "correct_proposal",
      proposalId: "3c000000-0000-4000-8000-00000000000a",
      correctedValue: "5% of claim, minimum KES 50,000",
    });
    const written = JSON.stringify(db.tables["audit_log"]);
    /* The label and the decision, never the figure: that belongs in the business record. */
    expect(written).toMatch(/document.term_corrected/);
    expect(written).not.toMatch(/50,000/);
  });

  it("refuses a review for somebody without the permission", async () => {
    await link();
    const body = await readJson(
      await act({ action: "accept_proposal", proposalId: "3c000000-0000-4000-8000-00000000000a" }, DOC, "tok-clerk"),
    );
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/may not review/);
  });

  it("says plainly that re-reading is not wired up, rather than appearing to start it", async () => {
    const body = await readJson(await act({ action: "read_document", documentId: DOC }));
    expect(body.outcome).toBe("blocked");
    expect(body.reason).toMatch(/not wired up in this deployment yet/);
  });
});

describe("a second reading of the same file", () => {
  const RESULT: ExtractionResult = {
    pages: [{ pageNumber: 1, text: "Own damage excess: 5% min KES 90,000", width: 612, height: 792 }],
    fields: [],
    terms: [
      {
        ordinal: 0,
        termType: "excess",
        label: "Excess 0",
        value: "5% of claim, minimum KES 90,000",
        amount: "90000",
        currency: "KES",
        page: 1,
        region: { x: 50, y: 120, width: 300, height: 12 },
        condition: "known",
        method: "labelled_line",
      },
      {
        ordinal: 1,
        termType: "excess",
        label: "Theft excess",
        value: "10% of claim",
        amount: null,
        currency: null,
        page: 1,
        region: { x: 50, y: 140, width: 300, height: 12 },
        condition: "known",
        method: "labelled_line",
      },
    ],
    needsManualReview: null,
  };

  function queued() {
    db.tables["documents"]![0]!["extraction_state"] = "queued";
    return fakeFactory(db).service();
  }

  it("updates its own proposals rather than duplicating them", async () => {
    await extractDocument(queued(), pino({ level: "silent" }), scriptedExtractor(RESULT), "bucket", DOC);
    const upserts = db.inserts.filter((i) => i.table === "document_term_proposals");
    expect(upserts).toHaveLength(2);
    expect(upserts.map((u) => u.row["ordinal"])).toEqual([0, 1]);
  });

  it("never overwrites a proposal a person has already decided", async () => {
    await link();
    await act({
      action: "correct_proposal",
      proposalId: "3c000000-0000-4000-8000-00000000000a",
      correctedValue: "5% of claim, minimum KES 50,000",
    });

    await extractDocument(queued(), pino({ level: "silent" }), scriptedExtractor(RESULT), "bucket", DOC);

    /* The corrected one is left alone; only the one still awaiting a decision is refreshed. */
    const touched = db.inserts.filter((i) => i.table === "document_term_proposals");
    expect(touched.map((u) => u.row["ordinal"])).toEqual([1]);
    expect(db.tables["document_term_proposals"]![0]!["corrected_value"]).toBe(
      "5% of claim, minimum KES 50,000",
    );
  });
});
