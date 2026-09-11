/**
 * Documents: upload, read, and extraction review.
 *
 * What these pin, in order of how expensive the mistake would be:
 *  - the browser cannot choose where a file lands, and a filename cannot escape its folder;
 *  - the same bytes twice are the same document, not two to reconcile;
 *  - an extracted value is not believed until a person decides, and the decision is audited;
 *  - a role without `document:edit` is told so, and the refusal is recorded;
 *  - a field with no position says so rather than offering a citation that opens nothing.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const READER = { id: "a0000000-0000-4000-8000-000000000004", email: "reader@acme-brokers.test" };
const DOC = "90000000-0000-4000-8000-00000000000a";
const FIELD = "91000000-0000-4000-8000-00000000000a";
const UNPLACED = "91000000-0000-4000-8000-00000000000b";
const SHA = "a".repeat(64);
const silentMailer: Mailer = { send: async () => ({ ok: true as const }) } as unknown as Mailer;

const membership = (user: string, roleKey: string, id: string) => ({
  id,
  organization_id: ORG_A,
  user_id: user,
  is_owner: roleKey === "brokerage_admin",
  status: "active",
  joined_at: "2026-01-01T00:00:00Z",
  organization: { id: ORG_A, name: "Acme Insurance Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  role: { id: `30000000-0000-4000-8000-00000000000${roleKey === "brokerage_admin" ? "1" : "2"}`, key: roleKey, name: roleKey, description: null, is_system: true },
});

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-reader": READER },
    inserts: [],
    rpc: {},
    // What 0034 gives a new document row before anyone has looked at it.
    defaults: {
      documents: { page_count: null, extraction_state: "not_started", extraction_error: null, deleted_at: null },
    },
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: null, active_organization_id: ORG_A },
        { id: READER.id, email: READER.email, full_name: "Reader", display_name: null, active_organization_id: ORG_A },
      ],
      organization_memberships: [
        membership(AMINA.id, "brokerage_admin", "60000000-0000-4000-8000-000000000001"),
        membership(READER.id, "account_executive", "60000000-0000-4000-8000-000000000002"),
      ],
      // The admin's role can edit documents; the account executive's cannot.
      role_permissions: [
        {
          role_id: "30000000-0000-4000-8000-000000000001",
          permission: { object_type: "document", verb: "edit" },
        },
      ],
      documents: [
        {
          id: DOC,
          organization_id: ORG_A,
          client_id: null,
          work_item_id: null,
          kind: "policy_schedule",
          filename: "acme-schedule.pdf",
          mime_type: "application/pdf",
          byte_size: 12345,
          storage_path: `${ORG_A}/unfiled/${DOC}/acme-schedule.pdf`,
          content_sha256: SHA,
          page_count: 2,
          extraction_state: "extracted",
          extraction_error: null,
          uploaded_by: AMINA.id,
          created_at: "2026-09-10T09:00:00Z",
          updated_at: "2026-09-10T09:00:00Z",
          deleted_at: null,
        },
        // Another brokerage's document, in the same table throughout.
        {
          id: "90000000-0000-4000-8000-00000000000b",
          organization_id: ORG_B,
          client_id: null,
          work_item_id: null,
          kind: "policy_schedule",
          filename: "beta-schedule.pdf",
          mime_type: "application/pdf",
          byte_size: 900,
          storage_path: `${ORG_B}/unfiled/x/beta-schedule.pdf`,
          content_sha256: "b".repeat(64),
          page_count: 1,
          extraction_state: "extracted",
          extraction_error: null,
          uploaded_by: AMINA.id,
          created_at: "2026-09-10T09:00:00Z",
          updated_at: "2026-09-10T09:00:00Z",
          deleted_at: null,
        },
      ],
      document_pages: [
        { id: "92000000-0000-4000-8000-00000000000a", organization_id: ORG_A, document_id: DOC, page_number: 1, text: "Motor commercial. Policy MC-4471.", width: 595, height: 842 },
      ],
      document_fields: [
        {
          id: FIELD,
          organization_id: ORG_A,
          document_id: DOC,
          field_key: "policy_number",
          proposed_value: "MC-4471",
          corrected_value: null,
          page_number: 1,
          region_x: 100,
          region_y: 220,
          region_width: 160,
          region_height: 18,
          state: "proposed",
          condition: "inferred",
          reviewed_by: null,
          reviewed_at: null,
          created_at: "2026-09-10T09:00:00Z",
        },
        {
          id: UNPLACED,
          organization_id: ORG_A,
          document_id: DOC,
          field_key: "sum_insured",
          proposed_value: "4,200,000",
          corrected_value: null,
          page_number: null,
          region_x: null,
          region_y: null,
          region_width: null,
          region_height: null,
          state: "proposed",
          condition: "inferred",
          reviewed_by: null,
          reviewed_at: null,
          created_at: "2026-09-10T09:00:00Z",
        },
      ],
      audit_log: [],
    },
  };
}

const hdr = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
// Test-only: bodies are asserted field by field, so a loose type is the honest one here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("documents", () => {
  let db: FakeDb;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    db = makeDb();
    app = createApp({
      logger: pino({ level: "silent" }),
      build: { version: "t", commit: "t" },
      supabase: fakeFactory(db),
      mailer: silentMailer,
      webBaseUrl: "http://localhost:5173",
      invitationTtlHours: 168,
      exposeAcceptUrl: true,
      executor: () => async () => {},
      bootToken: "test-boot",
    });
  });

  const upload = (body: Record<string, unknown>) =>
    app.request("/documents", { method: "POST", headers: hdr("tok-amina"), body: JSON.stringify(body) });

  const newFile = {
    filename: "quote.pdf",
    mimeType: "application/pdf",
    byteSize: 2048,
    contentSha256: "c".repeat(64),
  };

  it("puts a file inside the brokerage's own prefix, chosen by the server", async () => {
    const body = await readJson(await upload(newFile));
    expect(body.outcome).toBe("ready");
    expect(body.storagePath.startsWith(`${ORG_A}/`)).toBe(true);
  });

  it("refuses to let a filename escape its folder", async () => {
    const body = await readJson(await upload({ ...newFile, filename: "../../../etc/passwd" }));
    expect(body.storagePath).not.toContain("..");
    expect(body.storagePath.startsWith(`${ORG_A}/`)).toBe(true);
  });

  it("treats the same bytes as the document already on file", async () => {
    const body = await readJson(await upload({ ...newFile, contentSha256: SHA }));
    expect(body.outcome).toBe("already_on_file");
    expect(body.document.id).toBe(DOC);
    // Nothing new was written for a file that is already here.
    expect((db.tables["documents"] as unknown[]).length).toBe(2);
  });

  it("refuses a file over the limit before anything is written", async () => {
    const res = await upload({ ...newFile, byteSize: 999_999_999 });
    expect(res.status).toBe(413);
    expect((db.tables["documents"] as unknown[]).length).toBe(2);
  });

  it("returns a field's page and region, and says when there is none", async () => {
    const body = await readJson(await app.request(`/documents/${DOC}`, { headers: hdr("tok-amina") }));
    const placed = body.fields.find((f: { fieldKey: string }) => f.fieldKey === "policy_number");
    expect(placed.page).toBe(1);
    expect(placed.region).toMatchObject({ x: 100, y: 220, width: 160, height: 18 });
    const unplaced = body.fields.find((f: { fieldKey: string }) => f.fieldKey === "sum_insured");
    // Honest about having no position, rather than a citation that opens nothing.
    expect(unplaced.page).toBeNull();
    expect(unplaced.region).toBeNull();
  });

  it("does not reach another brokerage's document", async () => {
    const res = await app.request("/documents/90000000-0000-4000-8000-00000000000b", { headers: hdr("tok-amina") });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await readJson(res))).not.toContain("beta-schedule");
  });

  const review = (token: string, fieldId: string, body: Record<string, unknown>) =>
    app.request(`/documents/${DOC}/fields/${fieldId}/review`, {
      method: "POST",
      headers: hdr(token),
      body: JSON.stringify(body),
    });

  it("accepts an extracted value only when a person decides, and records who", async () => {
    const body = await readJson(await review("tok-amina", FIELD, { decision: "accept" }));
    expect(body.field.state).toBe("accepted");
    expect(body.field.condition).toBe("known");
    expect(body.field.reviewedBy).toBe(AMINA.id);
    expect(db.inserts.filter((i) => i.table === "audit_log")).toHaveLength(1);
  });

  it("keeps a correction apart from what the extractor read", async () => {
    const body = await readJson(await review("tok-amina", FIELD, { decision: "correct", value: "MC-4471-A" }));
    expect(body.field.state).toBe("corrected");
    expect(body.field.correctedValue).toBe("MC-4471-A");
    // What the extractor proposed is still there, so "who said this?" has an answer.
    expect(body.field.proposedValue).toBe("MC-4471");
  });

  it("refuses a correction with nothing typed", async () => {
    expect((await review("tok-amina", FIELD, { decision: "correct" })).status).toBe(400);
  });

  it("leaves a rejected field as missing, not as known", async () => {
    const body = await readJson(await review("tok-amina", FIELD, { decision: "reject" }));
    expect(body.field.state).toBe("rejected");
    expect(body.field.condition).toBe("missing");
  });

  it("tells a role that cannot review, and records the refusal", async () => {
    const res = await review("tok-reader", FIELD, { decision: "accept" });
    expect(res.status).toBe(403);
    const denied = db.inserts.filter((i) => i.table === "audit_log" && i.row["result"] === "denied");
    expect(denied).toHaveLength(1);
  });
});
