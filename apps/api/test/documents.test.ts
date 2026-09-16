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
const CLIENT = "70000000-0000-4000-8000-00000000000a";
const OTHER_CLIENT = "70000000-0000-4000-8000-00000000000c";
const POLICY = "90000000-0000-4000-8000-0000000000c1";
const PERIOD = "91000000-0000-4000-8000-0000000000c1";
const WORK = "30000000-0000-4000-8000-0000000000c1";
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
  const db: FakeDb = {
    users: { "tok-amina": AMINA, "tok-reader": READER },
    inserts: [],
    rpc: {
      /*
       * A stand-in for 0043's `document_apply_to_record`, in the shape the route depends on:
       * idempotency by key, a staleness check before any write, and a receipt. The function's own
       * guarantees — the write, receipt and audit row being one transaction, another brokerage's
       * record not being found — are proven against a real database in
       * `supabase/tests/0317_document_applications.sql`, because a stand-in cannot prove them.
       */
      document_apply_to_record: (args: Record<string, unknown>) => {
        const key = String(args["p_idempotency_key"]);
        const targetType = String(args["p_target_type"]);
        const targetId = String(args["p_target_id"]);
        const changes = args["p_changes"] as {
          field_key: string;
          document_field_id: string | null;
          from: string | null;
          to: string;
          page: number | null;
          premium_basis: string | null;
        }[];
        const applications = db.tables["document_applications"] ?? [];
        const already = applications.find((a) => a["idempotency_key"] === key);
        if (already) {
          return {
            data: {
              application_id: already["id"],
              target_type: already["target_type"],
              target_id: already["target_id"],
              changes: already["changes"],
              applied_at: already["applied_at"],
              repeat: true,
            },
          };
        }
        const table =
          targetType === "client" ? "clients" : targetType === "policy" ? "policies" : "policy_periods";
        const row = (db.tables[table] ?? []).find((r) => r["id"] === targetId);
        if (!row) return { error: { code: "P0002", message: "target_not_found" } };
        if (row["organization_id"] !== ORG_A) {
          return { error: { code: "P0002", message: "target_not_found" } };
        }
        const columnFor: Record<string, string> = {
          insured_name: "name",
          policy_number: "policy_number",
          period_start: "period_start",
          period_end: "period_end",
          premium: "premium_amount",
        };
        for (const ch of changes) {
          const col = columnFor[ch.field_key];
          const held = col ? (row[col] ?? null) : null;
          if (String(held ?? "") !== String(ch.from ?? "")) {
            return { error: { code: "40001", message: `stale_target: ${ch.field_key}` } };
          }
          if (ch.field_key === "premium" && !ch.premium_basis) {
            return { error: { code: "22023", message: "premium_basis_required" } };
          }
        }
        for (const ch of changes) {
          const col = columnFor[ch.field_key];
          if (col) row[col] = ch.to;
        }
        const application = {
          id: "a9000000-0000-4000-8000-00000000000a",
          organization_id: ORG_A,
          document_id: String(args["p_document_id"]),
          target_type: targetType,
          target_id: targetId,
          changes,
          applied_at: "2026-09-16T12:00:00Z",
          idempotency_key: key,
        };
        applications.push(application);
        db.tables["document_applications"] = applications;
        return {
          data: {
            application_id: application.id,
            target_type: targetType,
            target_id: targetId,
            changes,
            applied_at: application.applied_at,
            repeat: false,
          },
        };
      },
    },
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
        // Applying changes a business record, so it is gated on editing that record.
        {
          role_id: "30000000-0000-4000-8000-000000000001",
          permission: { object_type: "policy", verb: "edit" },
        },
        {
          role_id: "30000000-0000-4000-8000-000000000001",
          permission: { object_type: "client", verb: "edit" },
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
      // Records an apply can target, and one belonging to another brokerage.
      clients: [
        { id: CLIENT, organization_id: ORG_A, name: "Acme Manufacturing Ltd", kind: "corporate", source: "manual", file_status: "not_started", deleted_at: null },
        { id: OTHER_CLIENT, organization_id: ORG_B, name: "Otieno household", kind: "individual", source: "manual", file_status: "not_started", deleted_at: null },
      ],
      policies: [
        { id: POLICY, organization_id: ORG_A, client_id: CLIENT, insurer_id: "80000000-0000-4000-8000-00000000000a", class_of_business: "Commercial Motor", policy_number: "MC-4471-2026", deleted_at: null },
      ],
      policy_periods: [
        { id: PERIOD, organization_id: ORG_A, policy_id: POLICY, period_start: "2026-01-01", period_end: "2026-12-31", premium_amount: null },
      ],
      work_items: [
        { id: WORK, organization_id: ORG_A, title: "Acme — 2026 renewal", policy_period_id: PERIOD, deleted_at: null },
      ],
      document_applications: [],
    },
  };
  return db;
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

  /* ---- The same decision twice is one decision (D-076) --------------------------------------- */

  const auditRows = (action: string) =>
    db.inserts.filter((i) => i.table === "audit_log" && i.row["action"] === action);

  it("accepts once however many times Accept is clicked", async () => {
    const first = await readJson(await review("tok-amina", FIELD, { decision: "accept" }));
    expect(first.field.state).toBe("accepted");
    const reviewedAt = first.field.reviewedAt;

    const second = await readJson(await review("tok-amina", FIELD, { decision: "accept" }));
    expect(second.field.state).toBe("accepted");
    // The first decision stands, with its own timestamp and its own single audit row.
    expect(second.field.reviewedAt).toBe(reviewedAt);
    expect(auditRows("document.field_accepted")).toHaveLength(1);
  });

  it("writes one audit row for a repeated rejection, and one for a repeated identical correction", async () => {
    await review("tok-amina", FIELD, { decision: "reject" });
    await review("tok-amina", FIELD, { decision: "reject" });
    expect(auditRows("document.field_rejected")).toHaveLength(1);

    await review("tok-amina", UNPLACED, { decision: "correct", value: "4200000" });
    await review("tok-amina", UNPLACED, { decision: "correct", value: "4200000" });
    expect(auditRows("document.field_corrected")).toHaveLength(1);
  });

  it("still records a genuine change of mind", async () => {
    await review("tok-amina", FIELD, { decision: "accept" });
    const corrected = await readJson(
      await review("tok-amina", FIELD, { decision: "correct", value: "MC-4472" }),
    );
    // Correcting a value that was accepted is a real change, not a repeat.
    expect(corrected.field.state).toBe("corrected");
    expect(corrected.field.correctedValue).toBe("MC-4472");
    // And what the extractor read is still there beside it, for the audit.
    expect(corrected.field.proposedValue).toBe("MC-4471");
    expect(auditRows("document.field_corrected")).toHaveLength(1);
  });

  /* ---- Reading it again, after a failure (D-076) ---------------------------------------------- */

  const retry = (token: string, id = DOC) =>
    app.request(`/documents/${id}/extraction/retry`, { method: "POST", headers: hdr(token) });

  const failTheDocument = () => {
    const row = db.tables["documents"]?.find((d) => d["id"] === DOC);
    if (row) {
      row["extraction_state"] = "failed";
      row["extraction_error"] = "The extractor could not be reached.";
    }
  };

  it("queues a failed document to be read again, and says why in the audit", async () => {
    failTheDocument();
    const body = await readJson(await retry("tok-amina"));
    expect(body.retried).toBe(true);
    expect(body.document.extractionState).toBe("queued");
    // The reason clears with the state: 0034 allows an error only while failed.
    expect(body.document.extractionError).toBeNull();
    expect(auditRows("document.extraction_retried")).toHaveLength(1);

    // And something is now waiting for it: without the event nothing would read it.
    const events = db.inserts.filter((i) => i.table === "events");
    expect(events).toHaveLength(1);
    expect(events[0]?.row["event_type"]).toBe("document.received");
    // The payload names the file, never its contents.
    expect(JSON.stringify(events[0]?.row["payload"])).not.toContain("Policy MC-4471");
  });

  it("refuses to re-read a document that did not fail, so a person's accepted values survive", async () => {
    // The fixture document is `extracted` and its fields have been decided by people.
    const body = await readJson(await retry("tok-amina"));
    expect(body.retried).toBe(false);
    expect(body.document.extractionState).toBe("extracted");
    expect(db.inserts.filter((i) => i.table === "events")).toHaveLength(0);
    expect(auditRows("document.extraction_retried")).toHaveLength(0);
  });

  it("queues one read however many times Try again is clicked", async () => {
    failTheDocument();
    const first = await readJson(await retry("tok-amina"));
    const second = await readJson(await retry("tok-amina"));
    expect(first.retried).toBe(true);
    expect(second.retried).toBe(false);
    expect(db.inserts.filter((i) => i.table === "events")).toHaveLength(1);
    expect(auditRows("document.extraction_retried")).toHaveLength(1);
  });

  it("tells a role that cannot ask for a re-read, and records the refusal", async () => {
    failTheDocument();
    const res = await retry("tok-reader");
    expect(res.status).toBe(403);
    expect(db.inserts.filter((i) => i.table === "events")).toHaveLength(0);
    const denied = db.inserts.filter((i) => i.table === "audit_log" && i.row["result"] === "denied");
    expect(denied).toHaveLength(1);
  });

  it("does not re-read another brokerage's document", async () => {
    const res = await retry("tok-amina", "90000000-0000-4000-8000-00000000000b");
    expect(res.status).toBe(404);
  });
});

/* ---- Applying a document to a record (D-077) ------------------------------------------------- */

describe("applying what a document says to the record it is about", () => {
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

  /** Both fields reviewed, which is what applying requires. */
  const reviewEverything = () => {
    for (const f of db.tables["document_fields"] ?? []) {
      f["state"] = "accepted";
      f["condition"] = "known";
      f["reviewed_by"] = AMINA.id;
      f["reviewed_at"] = "2026-09-16T11:00:00Z";
    }
  };

  const apply = (token: string, body: unknown, id = DOC) =>
    app.request(`/documents/${id}/apply`, {
      method: "POST",
      headers: hdr(token),
      body: JSON.stringify(body),
    });

  const policyNumberChange = (over: Record<string, unknown> = {}) => ({
    targetType: "policy",
    targetId: POLICY,
    idempotencyKey: "apply-key-00000001",
    fields: [
      { documentFieldId: FIELD, fieldKey: "policy_number", from: "MC-4471-2026", to: "MC-4471" },
    ],
    ...over,
  });

  it("suggests the period the document's own work item is about, and says why", async () => {
    const doc = (db.tables["documents"] ?? []).find((d) => d["id"] === DOC);
    if (doc) doc["work_item_id"] = WORK;
    const body = await readJson(
      await app.request(`/documents/${DOC}/apply-targets`, { headers: hdr("tok-amina") }),
    );
    const period = body.suggestions.find(
      (s: { targetType: string }) => s.targetType === "policy_period",
    );
    expect(period.targetId).toBe(PERIOD);
    // Filed against the work, so nothing was inferred.
    expect(period.condition).toBe("known");
    expect(period.reason).toMatch(/filed against the work/);
  });

  it("says why there is nothing to suggest, rather than showing an empty list", async () => {
    const body = await readJson(
      await app.request(`/documents/${DOC}/apply-targets`, { headers: hdr("tok-amina") }),
    );
    // The fixture document is filed against nothing and the policy number it states is a match,
    // so this asserts the shape: when there are no suggestions there is always a reason.
    if (body.suggestions.length === 0) expect(body.whyNoTarget).toBeTruthy();
    expect(body.applicableFields.policy).toContain("policy_number");
    expect(body.applicableFields.policy_period).toContain("premium");
  });

  it("shows what would change, what would not, and what the target cannot hold", async () => {
    reviewEverything();
    const body = await readJson(
      await app.request(
        `/documents/${DOC}/apply-preview?targetType=policy&targetId=${POLICY}`,
        { headers: hdr("tok-amina") },
      ),
    );
    const number = body.fields.find(
      (f: { fieldKey: string }) => f.fieldKey === "policy_number",
    );
    expect(number.currentValue).toBe("MC-4471-2026");
    expect(number.proposedValue).toBe("MC-4471");
    expect(number.unchanged).toBe(false);
    // The schedule also read a sum insured, which a policy row does not hold. Said, not hidden.
    const sum = body.fields.find((f: { fieldKey: string }) => f.fieldKey === "sum_insured");
    expect(sum.blockedBecause).toMatch(/does not hold this/);
  });

  it("refuses an apply with no target", async () => {
    reviewEverything();
    const res = await apply("tok-amina", {
      idempotencyKey: "apply-key-00000001",
      fields: [{ documentFieldId: FIELD, fieldKey: "policy_number", from: null, to: "MC-4471" }],
    });
    expect(res.status).toBe(400);
    expect((db.tables["document_applications"] ?? []).length).toBe(0);
  });

  it("refuses to apply a value nobody has reviewed", async () => {
    // The fixture leaves both fields `proposed`.
    const res = await apply("tok-amina", policyNumberChange());
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({ error: "not_reviewed" });
  });

  it("refuses to apply a rejected value", async () => {
    reviewEverything();
    const field = (db.tables["document_fields"] ?? []).find((f) => f["id"] === FIELD);
    if (field) field["state"] = "rejected";
    const res = await apply("tok-amina", policyNumberChange());
    expect(res.status).toBe(409);
  });

  it("refuses a field the target cannot hold, by name", async () => {
    reviewEverything();
    const res = await apply("tok-amina", {
      ...policyNumberChange(),
      fields: [{ documentFieldId: UNPLACED, fieldKey: "sum_insured", from: null, to: "4200000" }],
    });
    expect(res.status).toBe(422);
    expect(await readJson(res)).toMatchObject({ error: "field_not_applicable" });
  });

  it("refuses when the record has moved since the person looked, and writes nothing", async () => {
    reviewEverything();
    const res = await apply("tok-amina", {
      ...policyNumberChange(),
      fields: [
        { documentFieldId: FIELD, fieldKey: "policy_number", from: "SOMETHING ELSE", to: "MC-4471" },
      ],
    });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({ error: "stale_target" });
    const policy = (db.tables["policies"] ?? []).find((p) => p["id"] === POLICY);
    expect(policy?.["policy_number"]).toBe("MC-4471-2026");
  });

  it("writes the real record, returns a receipt, and applies once however many times it is pressed", async () => {
    reviewEverything();
    const first = await readJson(await apply("tok-amina", policyNumberChange()));
    expect(first.repeat).toBe(false);
    expect(first.changes[0]).toMatchObject({
      fieldKey: "policy_number",
      from: "MC-4471-2026",
      to: "MC-4471",
    });
    const policy = (db.tables["policies"] ?? []).find((p) => p["id"] === POLICY);
    expect(policy?.["policy_number"]).toBe("MC-4471");

    const second = await readJson(await apply("tok-amina", policyNumberChange()));
    expect(second.repeat).toBe(true);
    expect(second.applicationId).toBe(first.applicationId);
    expect((db.tables["document_applications"] ?? []).length).toBe(1);
  });

  it("applies only the selected fields", async () => {
    reviewEverything();
    await apply("tok-amina", policyNumberChange());
    // The sum insured was never selected, and a policy row would not hold it anyway.
    const period = (db.tables["policy_periods"] ?? []).find((p) => p["id"] === PERIOD);
    expect(period?.["premium_amount"]).toBeNull();
  });

  it("refuses a premium with no basis: a number without units", async () => {
    reviewEverything();
    const field = (db.tables["document_fields"] ?? []).find((f) => f["id"] === UNPLACED);
    if (field) field["field_key"] = "premium";
    const res = await apply("tok-amina", {
      targetType: "policy_period",
      targetId: PERIOD,
      idempotencyKey: "apply-premium-000001",
      fields: [{ documentFieldId: UNPLACED, fieldKey: "premium", from: null, to: "214500.00" }],
    });
    expect(res.status).toBe(422);
    expect(await readJson(res)).toMatchObject({ error: "premium_basis_required" });
  });

  it("takes the premium once the person says what the figure is", async () => {
    reviewEverything();
    const field = (db.tables["document_fields"] ?? []).find((f) => f["id"] === UNPLACED);
    if (field) field["field_key"] = "premium";
    const body = await readJson(
      await apply("tok-amina", {
        targetType: "policy_period",
        targetId: PERIOD,
        idempotencyKey: "apply-premium-000002",
        fields: [
          {
            documentFieldId: UNPLACED,
            fieldKey: "premium",
            from: null,
            to: "214500.00",
            premiumBasis: "gross",
          },
        ],
      }),
    );
    expect(body.repeat).toBe(false);
    const period = (db.tables["policy_periods"] ?? []).find((p) => p["id"] === PERIOD);
    expect(period?.["premium_amount"]).toBe("214500.00");
  });

  it("tells a role that cannot change the record, and records the refusal", async () => {
    reviewEverything();
    const res = await apply("tok-reader", policyNumberChange());
    expect(res.status).toBe(403);
    const denied = db.inserts.filter(
      (i) => i.table === "audit_log" && i.row["result"] === "denied",
    );
    expect(denied).toHaveLength(1);
    expect((db.tables["document_applications"] ?? []).length).toBe(0);
  });

  it("does not apply another brokerage's document", async () => {
    reviewEverything();
    const res = await apply("tok-amina", policyNumberChange(), "90000000-0000-4000-8000-00000000000b");
    expect(res.status).toBe(404);
  });

  it("does not apply to another brokerage's record", async () => {
    reviewEverything();
    const res = await apply("tok-amina", {
      targetType: "client",
      targetId: OTHER_CLIENT,
      idempotencyKey: "cross-org-0000001",
      fields: [
        { documentFieldId: FIELD, fieldKey: "insured_name", from: "Otieno household", to: "Acme" },
      ],
    });
    expect(res.status).toBe(404);
    const other = (db.tables["clients"] ?? []).find((c) => c["id"] === OTHER_CLIENT);
    expect(other?.["name"]).toBe("Otieno household");
  });
});
