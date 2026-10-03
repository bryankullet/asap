/**
 * The police-abstract failure, connected (D-135). Against the real `document_fields` unique index:
 * a reading that reports one field twice used to be refused whole ("What was read could not be
 * recorded"); now it is recorded as one proposal per field — differing readings marked conflicting —
 * and the document finishes extracted with its page. Nothing is accepted on anyone's behalf.
 */
import { randomUUID } from "node:crypto";
import pino from "pino";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractDocument } from "../../src/documents/extraction.js";
import { scriptedExtractor, type ExtractionResult } from "../../src/documents/extractor.js";
import { AMINA, ORG_A, OWNER, serviceClient } from "./_harness.js";

let sql: postgres.Sql;
beforeAll(() => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await sql.end();
});

const ABSTRACT: ExtractionResult = {
  pages: [
    {
      pageNumber: 1,
      text: "UX TEST POLICE ABSTRACT — KDM 811A — 02/10/2026 (fictional, for software testing)",
      width: 595,
      height: 842,
    },
  ],
  fields: [
    {
      fieldKey: "insured_name",
      value: "UX TEST Karibu Logistics Ltd",
      page: 1,
      region: { x: 40, y: 700, width: 200, height: 12 },
      condition: "known",
    },
    {
      fieldKey: "insured_name",
      value: "UX TEST Karibu Logistics Ltd",
      page: 1,
      region: { x: 40, y: 400, width: 200, height: 12 },
      condition: "known",
    },
    {
      fieldKey: "period_start",
      value: "02/10/2026",
      page: 1,
      region: { x: 40, y: 650, width: 80, height: 12 },
      condition: "conflicting",
    },
    {
      fieldKey: "period_start",
      value: "03/10/2026",
      page: 1,
      region: { x: 40, y: 300, width: 80, height: 12 },
      condition: "conflicting",
    },
    { fieldKey: "premium", value: null, page: null, region: null, condition: "missing" },
  ],
  terms: [],
  needsManualReview: null,
};

describe("a document stating a field twice, against the real database", () => {
  it("the real unique index refuses two rows for one field — the cause of the hosted failure", async () => {
    const [doc] =
      await sql`insert into documents (organization_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, extraction_state, uploaded_by)
      values (${ORG_A}, 'other', 'dup-proof.pdf', 'application/pdf', 10, ${`${ORG_A}/${randomUUID()}.pdf`}, ${randomUUID().replace(/-/g, "").padEnd(64, "0")}, 'extracted', ${AMINA.id}) returning id`;
    const db = serviceClient();
    const r = await db.from("document_fields").insert([
      {
        organization_id: ORG_A,
        document_id: doc!["id"],
        field_key: "period_start",
        proposed_value: "02/10/2026",
        state: "proposed",
        condition: "conflicting",
      },
      {
        organization_id: ORG_A,
        document_id: doc!["id"],
        field_key: "period_start",
        proposed_value: "03/10/2026",
        state: "proposed",
        condition: "conflicting",
      },
    ]);
    expect(r.error?.code).toBe("23505");
  });

  it("is now recorded: one proposal per field, conflicting kept visible, the document extracted with its page", async () => {
    const [doc] =
      await sql`insert into documents (organization_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, extraction_state, uploaded_by)
      values (${ORG_A}, 'other', '10_UX_TEST_KDM_811A_Police_Abstract.pdf', 'application/pdf', 10, ${`${ORG_A}/${randomUUID()}.pdf`}, ${randomUUID().replace(/-/g, "").padEnd(64, "1")}, 'queued', ${AMINA.id}) returning id`;
    const id = doc!["id"] as string;
    const db = serviceClient();
    // Storage is the one stand-in: the bytes are not what is under test, the recording is.
    (db as unknown as { storage: unknown }).storage = {
      from: () => ({
        download: async () => ({ data: new Blob(["%PDF-1.4 fictional"]), error: null }),
      }),
    };
    const out = await extractDocument(
      db,
      pino({ level: "silent" }),
      scriptedExtractor(ABSTRACT),
      "bucket",
      id,
    );
    expect(out).toEqual({ state: "extracted", pages: 1, fields: 5 });
    const [d] =
      await sql`select extraction_state, extraction_error, page_count from documents where id = ${id}`;
    expect(d).toMatchObject({
      extraction_state: "extracted",
      extraction_error: null,
      page_count: 1,
    });
    const fields =
      await sql`select field_key, proposed_value, condition, state, page_number from document_fields where document_id = ${id} order by field_key`;
    expect(
      fields.map((f) => [f["field_key"], f["proposed_value"], f["condition"], f["state"]]),
    ).toEqual([
      ["insured_name", "UX TEST Karibu Logistics Ltd", "known", "proposed"],
      ["period_start", "02/10/2026", "conflicting", "proposed"],
      ["premium", null, "missing", "proposed"],
    ]);
    const [p] = await sql`select count(*)::int as n from document_pages where document_id = ${id}`;
    expect(p!["n"]).toBe(1);
  });

  it("re-reading a re-queued document refreshes its proposals and never touches a decided value (D-136)", async () => {
    const [doc] =
      await sql`insert into documents (organization_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, extraction_state, uploaded_by)
      values (${ORG_A}, 'other', 'reread.pdf', 'application/pdf', 10, ${`${ORG_A}/${randomUUID()}.pdf`}, ${randomUUID().replace(/-/g, "").padEnd(64, "2")}, 'queued', ${AMINA.id}) returning id`;
    const id = doc!["id"] as string;
    const db = serviceClient();
    (db as unknown as { storage: unknown }).storage = {
      from: () => ({ download: async () => ({ data: new Blob(["%PDF-1.4 fictional"]), error: null }) }),
    };
    const first: ExtractionResult = {
      ...ABSTRACT,
      fields: [
        { fieldKey: "insured_name", value: "UX TEST Karibu Logistics Ltd", page: 1, region: null, condition: "known" },
        { fieldKey: "premium", value: "KES 1", page: 1, region: null, condition: "known" },
      ],
      terms: [{ ordinal: 0, termType: "limit", label: "Geographical limit", value: "Kenya. Wear and tear", amount: null, currency: null, page: 1, region: null, condition: "known", method: "labelled_line" }],
    };
    expect((await extractDocument(db, pino({ level: "silent" }), scriptedExtractor(first), "bucket", id)).state).toBe("extracted");
    // A person accepts the insured name.
    await sql`update document_fields set state = 'accepted', reviewed_by = ${AMINA.id}, reviewed_at = now() where document_id = ${id} and field_key = 'insured_name'`;

    await sql`update documents set extraction_state = 'queued' where id = ${id}`;
    const second: ExtractionResult = {
      ...ABSTRACT,
      fields: [
        { fieldKey: "insured_name", value: "SOMETHING ELSE", page: 1, region: null, condition: "known" },
        { fieldKey: "premium", value: "KES 5,180,000", page: 1, region: null, condition: "known" },
      ],
      terms: [
        { ordinal: 0, termType: "other", label: "Geographic scope", value: "Kenya.", amount: null, currency: null, page: 1, region: null, condition: "known", method: "labelled_line" },
        { ordinal: 1, termType: "exclusion", label: "Key exclusions", value: "Wear and tear", amount: null, currency: null, page: 1, region: null, condition: "known", method: "labelled_line" },
      ],
    };
    expect((await extractDocument(db, pino({ level: "silent" }), scriptedExtractor(second), "bucket", id)).state).toBe("extracted");
    const fields = await sql`select field_key, proposed_value, state from document_fields where document_id = ${id} order by field_key`;
    expect(fields.map((f) => [f["field_key"], f["proposed_value"], f["state"]])).toEqual([
      ["insured_name", "UX TEST Karibu Logistics Ltd", "accepted"],
      ["premium", "KES 5,180,000", "proposed"],
    ]);
    const terms = await sql`select ordinal, term_type, label, proposed_value from document_term_proposals where document_id = ${id} order by ordinal`;
    expect(terms.map((t) => [t["term_type"], t["label"], t["proposed_value"]])).toEqual([
      ["other", "Geographic scope", "Kenya."],
      ["exclusion", "Key exclusions", "Wear and tear"],
    ]);
  });
});
