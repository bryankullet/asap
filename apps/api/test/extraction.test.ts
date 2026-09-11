/**
 * Reading a filed document (D-072).
 *
 * The line this holds: **extraction proposes, and never decides.** Every field it writes is
 * `proposed`, and a document that has already been read is left alone — a redelivered event must
 * not replace a person's accepted values with fresh guesses, which is the one thing this path
 * must never do.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { extractDocument } from "../src/documents/extraction.js";
import { ExtractorUnavailable, scriptedExtractor, type Extractor } from "../src/documents/extractor.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const DOC = "d0000000-0000-4000-8000-000000000001";
const logger = pino({ level: "silent" });

const RESULT = {
  pages: [{ pageNumber: 1, text: "Policy No: MAR-4471", width: 612, height: 792 }],
  fields: [
    {
      fieldKey: "policy_number",
      value: "MAR-4471",
      page: 1,
      region: { x: 50, y: 700, width: 120, height: 14 },
      condition: "known" as const,
    },
    { fieldKey: "premium", value: null, page: null, region: null, condition: "missing" as const },
  ],
};

function makeDb(state = "queued"): FakeDb {
  return {
    users: {},
    inserts: [],
    rpc: {},
    tables: {
      documents: [
        {
          id: DOC,
          organization_id: ORG,
          filename: "schedule.pdf",
          mime_type: "application/pdf",
          storage_path: `${ORG}/schedule.pdf`,
          extraction_state: state,
          deleted_at: null,
        },
      ],
      document_pages: [],
      document_fields: [],
    },
  };
}

let db: FakeDb;
const client = () => fakeFactory(db).service();
beforeEach(() => {
  db = makeDb();
});

describe("reading a document", () => {
  it("records the pages and proposes the values", async () => {
    const out = await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    expect(out).toEqual({ state: "extracted", pages: 1, fields: 2 });

    const page = db.inserts.find((i) => i.table === "document_pages");
    expect(page?.row["page_number"]).toBe(1);

    const fields = db.inserts.filter((i) => i.table === "document_fields");
    expect(fields).toHaveLength(2);
  });

  it("writes every field as proposed, never as known", async () => {
    await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    const fields = db.inserts.filter((i) => i.table === "document_fields");
    // A value that reached a record without a person accepting it is the defect the review
    // screen exists to prevent (§45 rule 8).
    expect(fields.every((f) => f.row["state"] === "proposed")).toBe(true);
  });

  it("keeps the condition the extractor gave, including 'missing'", async () => {
    await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    const fields = db.inserts.filter((i) => i.table === "document_fields");
    const missing = fields.find((f) => f.row["field_key"] === "premium");
    // A field the document never gave is proposed as missing rather than left out, so the screen
    // shows the absence instead of leaving a person to notice it.
    expect(missing?.row["condition"]).toBe("missing");
    expect(missing?.row["proposed_value"]).toBeNull();
  });

  it("records where each value was read from", async () => {
    await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    const policy = db.inserts
      .filter((i) => i.table === "document_fields")
      .find((f) => f.row["field_key"] === "policy_number");
    expect(policy?.row["page_number"]).toBe(1);
    expect(policy?.row["region_x"]).toBe(50);
  });
});

describe("what it refuses to do", () => {
  it("leaves a document that has already been read alone", async () => {
    // A redelivered event must not replace a person's accepted values with fresh proposals.
    db = makeDb("extracted");
    const out = await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    expect(out.state).toBe("skipped");
    expect(db.inserts.filter((i) => i.table === "document_fields")).toHaveLength(0);
  });

  it("leaves a document nobody has filed alone", async () => {
    db = makeDb("not_started");
    const out = await extractDocument(client(), logger, scriptedExtractor(RESULT), "bucket", DOC);
    expect(out.state).toBe("skipped");
  });

  it("says so when the deployment has no extraction service", async () => {
    const out = await extractDocument(client(), logger, null, "bucket", DOC);
    expect(out).toMatchObject({ state: "skipped" });
    if (out.state !== "skipped") return;
    expect(out.reason).toMatch(/no extraction service/i);
  });
});

describe("when it goes wrong", () => {
  it("tells a service that is down apart from a document that cannot be read", async () => {
    const down: Extractor = {
      extract: () => Promise.reject(new ExtractorUnavailable("connect ECONNREFUSED")),
    };
    const out = await extractDocument(client(), logger, down, "bucket", DOC);
    expect(out.state).toBe("failed");
    if (out.state !== "failed") return;
    // Different facts, and the difference matters to whoever has to act on it.
    expect(out.reason).toMatch(/could not be reached/i);
    expect(out.reason).toMatch(/still on file/i);
  });

  it("records a failure on the document, in words", async () => {
    const broken: Extractor = { extract: () => Promise.reject(new Error("boom")) };
    await extractDocument(client(), logger, broken, "bucket", DOC);
    const doc = db.tables["documents"]![0]!;
    expect(doc["extraction_state"]).toBe("failed");
    expect(String(doc["extraction_error"])).toMatch(/could not be read/i);
    // Never the contents, and never a stack trace.
    expect(String(doc["extraction_error"])).not.toMatch(/boom/);
  });
});
