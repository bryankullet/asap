import {
  DOCUMENT_FIELD_COLUMNS,
  DOCUMENT_PAGE_COLUMNS,
  documentDetailSchema,
  documentsResponseSchema,
  documentFiledResponseSchema,
  reviewFieldRequestSchema,
  APPLICABLE_FIELDS,
  ApplyTargetType,
  applyPreviewResponseSchema,
  applyRequestSchema,
  applyResponseSchema,
  applyTargetsResponseSchema,
  retryExtractionResponseSchema,
  reviewFieldResponseSchema,
  uploadRequestSchema,
  uploadResponseSchema,
  type DocumentField,
  type ApplyPreviewField,
  type ApplyTarget,
  type ApplyTargetType as ApplyTargetTypeValue,
  type DocumentSummary,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { emitEvent } from "../events/emit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/**
 * Documents: upload, read, and extraction review.
 *
 * Four things this file is careful about:
 *
 *  1. **The browser never chooses where a file lands.** The server builds the storage path inside
 *     the brokerage's own prefix. A path supplied by the browser could name another brokerage's
 *     folder, and 0012's policies key on that first path segment.
 *  2. **The bucket is private and stays private.** Reads are short-lived signed URLs, minted per
 *     request. There is no public URL and none is stored (§45 rule 2: nothing goes to a third
 *     party for indexing or storage; extraction runs on our own service).
 *  3. **The same bytes are the same document.** A second upload of a file already on file returns
 *     the document that exists, rather than a duplicate a person would have to reconcile.
 *  4. **An extracted value is not a business value until a person decides.** Review writes the
 *     decision and the decider, and audits it, because accepting a figure off a schedule is a
 *     business action.
 */

type DocumentRow = {
  id: string;
  organization_id: string;
  client_id: string | null;
  work_item_id: string | null;
  kind: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  page_count: number | null;
  extraction_state: string;
  extraction_error: string | null;
  created_at: string;
};

function summarise(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    kind: row.kind as DocumentSummary["kind"],
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    pageCount: row.page_count,
    extractionState: row.extraction_state as DocumentSummary["extractionState"],
    extractionError: row.extraction_error,
    clientId: row.client_id,
    workItemId: row.work_item_id,
    createdAt: row.created_at,
  };
}

type FieldRow = {
  id: string;
  field_key: string;
  proposed_value: string | null;
  corrected_value: string | null;
  page_number: number | null;
  region_x: number | null;
  region_y: number | null;
  region_width: number | null;
  region_height: number | null;
  state: string;
  condition: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

function toField(row: FieldRow): DocumentField {
  const hasRegion =
    row.region_x !== null && row.region_y !== null && row.region_width !== null && row.region_height !== null;
  return {
    id: row.id,
    fieldKey: row.field_key,
    proposedValue: row.proposed_value,
    correctedValue: row.corrected_value,
    state: row.state as DocumentField["state"],
    condition: row.condition as DocumentField["condition"],
    page: row.page_number,
    // All four or none — the row constraint says so, and this reads it the same way.
    region: hasRegion
      ? {
          x: Number(row.region_x),
          y: Number(row.region_y),
          width: Number(row.region_width),
          height: Number(row.region_height),
        }
      : null,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

/** Only what the storage layer will accept in a key, so a filename cannot escape its folder. */
function safeName(filename: string): string {
  // Dot runs go entirely: `..` cannot traverse once the slashes are gone, but a name carrying it
  // is still a name that reads like an attempt, and nothing needs it.
  const cleaned = filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, ".").replace(/^[._]+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

/** The columns a document summary needs. Never the storage token, never the contents. */
const DOCUMENT_SUMMARY_COLUMNS =
  "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, page_count, extraction_state, extraction_error, created_at";

/**
 * What our extractor can actually open (`apps/extractor/src/asap_extractor/extract.py`).
 *
 * A file outside this list is still accepted and still stored — a brokerage may file anything —
 * but nothing will read it, and the screen says so instead of leaving it queued for ever.
 */
const READABLE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
] as const;

/**
 * Fields whose values are amounts, and so compare as numbers rather than as text.
 *
 * A schedule prints `214,500.00`; the column holds `214500.00`. Comparing those as strings made
 * an applied premium look unapplied and offered a person the same write again.
 */
const AMOUNT_FIELDS = new Set(["premium", "sum_insured"]);

/** The same reading 0043's `app.text_to_amount` does, for comparison only — never for a write. */
function sameValue(fieldKey: string, held: string | null, proposed: string | null): boolean {
  if (held === null || proposed === null) return false;
  if (!AMOUNT_FIELDS.has(fieldKey)) return held === proposed;
  const asNumber = (v: string) => {
    const cleaned = v.replace(/[^0-9.,+-]/g, "");
    const plain = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)
      ? cleaned.replace(/,/g, "")
      : cleaned;
    return /^[-+]?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
  };
  const a = asNumber(held);
  const b = asNumber(proposed);
  // Two figures neither of which reads as a number are not "the same": say so and let a person look.
  return a !== null && b !== null && a === b;
}

/** A uuid, for a query parameter that has to be one before it reaches a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a period of cover is called on screen: the client, the class, and the dates.
 *
 * Built from the rows rather than stored, and read under the caller's own session, so a label
 * cannot name a record the person could not otherwise see.
 */
async function periodLabel(
  db: SupabaseClient,
  orgId: string,
  periodId: string,
): Promise<string | null> {
  const res = await db
    .from("policy_periods")
    .select("id, period_start, period_end, policy_id")
    .eq("organization_id", orgId)
    .eq("id", periodId)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const period = res.data as { period_start: string; period_end: string; policy_id: string };
  const pol = await db
    .from("policies")
    .select("id, class_of_business, client_id")
    .eq("organization_id", orgId)
    .eq("id", period.policy_id)
    .maybeSingle();
  if (pol.error || !pol.data) return null;
  const policy = pol.data as { class_of_business: string; client_id: string };
  const cli = await db
    .from("clients")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("id", policy.client_id)
    .maybeSingle();
  const name = cli.error || !cli.data ? null : (cli.data as { name: string }).name;
  const year = period.period_start.slice(0, 4);
  return `${name ?? "Unknown client"} · ${policy.class_of_business} · ${year}`;
}

/**
 * What the target holds right now, per field key, and what to call it.
 *
 * The keys are the extractor's own field keys, so a preview compares like with like: the value on
 * the record against the value read off the document, never a column name against a label.
 */
async function currentValues(
  db: SupabaseClient,
  orgId: string,
  targetType: "policy_period" | "policy" | "client",
  targetId: string,
): Promise<{ label: string; values: Record<string, string | null> } | null> {
  if (targetType === "policy_period") {
    const res = await db
      .from("policy_periods")
      .select("id, period_start, period_end, premium_amount")
      .eq("organization_id", orgId)
      .eq("id", targetId)
      .maybeSingle();
    if (res.error || !res.data) return null;
    const row = res.data as {
      period_start: string;
      period_end: string;
      premium_amount: string | number | null;
    };
    const label = (await periodLabel(db, orgId, targetId)) ?? "This period of cover";
    return {
      label,
      values: {
        period_start: row.period_start,
        period_end: row.period_end,
        premium: row.premium_amount === null ? null : String(row.premium_amount),
      },
    };
  }
  if (targetType === "policy") {
    const res = await db
      .from("policies")
      .select("id, policy_number, class_of_business")
      .eq("organization_id", orgId)
      .eq("id", targetId)
      .is("deleted_at", null)
      .maybeSingle();
    if (res.error || !res.data) return null;
    const row = res.data as { policy_number: string | null; class_of_business: string };
    return {
      label: `${row.class_of_business} · ${row.policy_number ?? "no number"}`,
      values: { policy_number: row.policy_number },
    };
  }
  const res = await db
    .from("clients")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("id", targetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const row = res.data as { name: string };
  return { label: row.name, values: { insured_name: row.name } };
}

export function documentRoutes(deps: {
  logger: Logger;
  bucket: string;
  signedUrlTtlSeconds: number;
  maxUploadBytes: number;
}) {
  const app = new Hono();

  app.get("/documents", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    let q = db
      .from("documents")
      .select(
        DOCUMENT_SUMMARY_COLUMNS,
      )
      .eq("organization_id", org.id)
      .is("deleted_at", null);
    const clientId = c.req.query("clientId");
    const workItemId = c.req.query("workItemId");
    if (clientId) q = q.eq("client_id", clientId);
    if (workItemId) q = q.eq("work_item_id", workItemId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(
      documentsResponseSchema.parse({
        documents: ((data ?? []) as DocumentRow[]).map(summarise),
        limits: { maxBytes: deps.maxUploadBytes, readableMimeTypes: READABLE_MIME_TYPES },
      }),
    );
  });

  app.get("/documents/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");

    const { data, error } = await db
      .from("documents")
      .select(
        DOCUMENT_SUMMARY_COLUMNS,
      )
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return sendError(c, mapDatabaseError(error));
    if (!data) throw new HttpError(404, "not_found", "That document is not available.");
    const doc = data as DocumentRow;

    const [pagesR, fieldsR] = await Promise.all([
      db
        .from("document_pages")
        .select(DOCUMENT_PAGE_COLUMNS)
        .eq("document_id", id)
        .order("page_number", { ascending: true }),
      db
        .from("document_fields")
        .select(DOCUMENT_FIELD_COLUMNS)
        .eq("document_id", id)
        .order("field_key", { ascending: true }),
    ]);
    if (pagesR.error) return sendError(c, mapDatabaseError(pagesR.error));
    if (fieldsR.error) return sendError(c, mapDatabaseError(fieldsR.error));

    // A signed URL, minted now and short-lived. If signing fails the document still renders —
    // its text, its fields and their positions are all in the database — and the viewer says the
    // file itself could not be opened rather than showing a broken frame.
    let fileUrl: string | null = null;
    let fileUrlExpiresAt: string | null = null;
    const signed = await db.storage
      .from(deps.bucket)
      .createSignedUrl(doc.storage_path, deps.signedUrlTtlSeconds);
    if (signed.data?.signedUrl) {
      fileUrl = signed.data.signedUrl;
      fileUrlExpiresAt = new Date(Date.now() + deps.signedUrlTtlSeconds * 1000).toISOString();
    } else {
      deps.logger.warn({ documentId: id }, "could not sign a document url");
    }

    return c.json(
      documentDetailSchema.parse({
        document: summarise(doc),
        pages: ((pagesR.data ?? []) as { page_number: number; width: number; height: number; text: string }[]).map(
          (p) => ({
            pageNumber: p.page_number,
            width: Number(p.width),
            height: Number(p.height),
            text: p.text,
          }),
        ),
        fields: ((fieldsR.data ?? []) as FieldRow[]).map(toField),
        fileUrl,
        fileUrlExpiresAt,
      }),
    );
  });

  /**
   * Ask for somewhere to put a file. The row is written first, so a file that lands in storage
   * always has a record that explains what it is — an orphaned object with nothing describing it
   * is worse than an upload that failed.
   */
  app.post("/documents", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = uploadRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "A file description is required.");
    const req = parsed.data;
    if (req.byteSize > deps.maxUploadBytes) {
      throw new HttpError(413, "file_too_large", `Files must be under ${Math.floor(deps.maxUploadBytes / 1_048_576)} MB.`);
    }

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    // Already on file? The same bytes in the same brokerage are the same document.
    const { data: existing, error: existingErr } = await db
      .from("documents")
      .select(
        DOCUMENT_SUMMARY_COLUMNS,
      )
      .eq("organization_id", org.id)
      .eq("content_sha256", req.contentSha256)
      .is("deleted_at", null)
      .maybeSingle();
    if (existingErr) return sendError(c, mapDatabaseError(existingErr));
    if (existing) {
      return c.json(
        uploadResponseSchema.parse({
          outcome: "already_on_file",
          document: summarise(existing as DocumentRow),
        }),
      );
    }

    // The path is ours to build: brokerage first, because 0012's policies key on that segment.
    const documentId = crypto.randomUUID();
    const scope = req.workItemId ? `work_items/${req.workItemId}` : req.clientId ? `clients/${req.clientId}` : "unfiled";
    const storagePath = `${org.id}/${scope}/${documentId}/${safeName(req.filename)}`;

    const { data: inserted, error } = await db
      .from("documents")
      .insert({
        id: documentId,
        organization_id: org.id,
        client_id: req.clientId,
        work_item_id: req.workItemId,
        kind: req.kind,
        filename: req.filename,
        mime_type: req.mimeType,
        byte_size: req.byteSize,
        storage_path: storagePath,
        content_sha256: req.contentSha256,
        uploaded_by: user.id,
      })
      .select(
        DOCUMENT_SUMMARY_COLUMNS,
      )
      .single();
    if (error) return sendError(c, mapDatabaseError(error));

    const signed = await db.storage.from(deps.bucket).createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data) {
      deps.logger.error({ documentId }, "could not sign an upload url");
      throw new HttpError(503, "storage_unavailable", "The file store could not be reached. Nothing was uploaded.");
    }

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "document.upload_started",
      objectType: "document",
      objectId: documentId,
      result: "success",
      // The filename and kind, never the contents. `redactForAudit` would strip a `content` key
      // anyway; not putting one here is the first line of that defence.
      newState: { filename: req.filename, kind: req.kind },
    });

    return c.json(
      uploadResponseSchema.parse({
        outcome: "ready",
        document: summarise(inserted as DocumentRow),
        uploadUrl: signed.data.signedUrl,
        uploadToken: signed.data.token,
        storagePath,
      }),
    );
  });

  /**
   * The bytes arrived.
   *
   * The browser uploads straight to storage, so the API never sees the transfer and would
   * otherwise never learn it finished — the file would sit in the bucket with nothing waiting on
   * it. This is the signal that puts the document in the queue to be read.
   *
   * It checks the object is really there rather than taking the browser's word for it. A client
   * that called this without uploading anything would otherwise queue a document that does not
   * exist, and the extractor would fail on it later and further away from the cause.
   */
  app.post("/documents/:id/filed", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const found = await db
      .from("documents")
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (found.error) return sendError(c, mapDatabaseError(found.error));
    if (!found.data) throw new HttpError(404, "not_found", "No document with that id");
    const row = found.data as DocumentRow;

    // Already queued or read: saying so beats queueing it twice, and a retried request from a
    // flaky connection is the ordinary case rather than the exception.
    if (row.extraction_state !== "not_started") {
      return c.json(
        documentFiledResponseSchema.parse({ document: summarise(row), filed: true }),
      );
    }

    const exists = await db.storage.from(deps.bucket).createSignedUrl(row.storage_path, 60);
    if (exists.error || !exists.data) {
      return c.json(documentFiledResponseSchema.parse({ document: summarise(row), filed: false }));
    }

    const queued = await db
      .from("documents")
      .update({ extraction_state: "queued", updated_at: new Date().toISOString() })
      .eq("organization_id", org.id)
      .eq("id", id)
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .single();
    if (queued.error) return sendError(c, mapDatabaseError(queued.error));

    /*
     * What arrived, so anything waiting for a document can act on it. The filename and kind, never
     * a byte of the contents: a consumer that needs the document reads it from storage under its
     * own rights.
     */
    await emitEvent(db, deps.logger, {
      organizationId: org.id,
      eventType: "document.received",
      entityType: "document",
      entityId: id,
      actor: "user",
      actorUserId: user.id,
      payload: { kind: row.kind, filename: row.filename, clientId: row.client_id, workItemId: row.work_item_id },
    });

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "document.filed",
      objectType: "document",
      objectId: id,
      result: "success",
      newState: { filename: row.filename, kind: row.kind },
    });

    return c.json(
      documentFiledResponseSchema.parse({ document: summarise(queued.data as DocumentRow), filed: true }),
    );
  });

  /**
   * Read it again, after a failure.
   *
   * Extraction can fail for reasons that pass: the extractor was redeploying, a scan was slow, the
   * network went. A person who can see "Failed" and nothing else has to re-upload the same file,
   * which makes a second document out of one.
   *
   * **Only from `failed`.** From anywhere else a retry would re-propose over values somebody has
   * already accepted or corrected, and a machine overwriting a person's decision is the failure
   * this whole review flow exists to prevent. A retry of a queued document answers
   * `retried: false` and changes nothing — a second click is ordinary, not an error.
   */
  app.post("/documents/:id/extraction/retry", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    // Reading a document again changes what the brokerage will be told it says, so it is gated
    // like the review itself rather than open to anyone who can open the file.
    if (!hasPermission(ctx, "document", "edit")) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "document.extraction_retry",
        objectType: "document",
        objectId: id,
        result: "denied",
        failureReason: "missing document:edit",
      });
      throw new HttpError(403, "forbidden", "Your role cannot ask for a document to be read again.");
    }

    const found = await db
      .from("documents")
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (found.error) return sendError(c, mapDatabaseError(found.error));
    if (!found.data) throw new HttpError(404, "not_found", "No document with that id");
    const row = found.data as DocumentRow;

    if (row.extraction_state !== "failed") {
      return c.json(
        retryExtractionResponseSchema.parse({ document: summarise(row), retried: false }),
      );
    }

    // The bytes have to still be there. Queueing a read of an object that is gone would turn one
    // honest failure into a second one with a more confusing reason.
    const exists = await db.storage.from(deps.bucket).createSignedUrl(row.storage_path, 60);
    if (exists.error || !exists.data) {
      throw new HttpError(
        409,
        "file_missing",
        "The file is no longer in storage, so it cannot be read again. Upload it once more.",
      );
    }

    const queued = await db
      .from("documents")
      .update({
        extraction_state: "queued",
        // The constraint allows an error only while failed, so it clears with the state.
        extraction_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", org.id)
      .eq("id", id)
      // Only if nobody else has already moved it: two people clicking Try again queue one read.
      .eq("extraction_state", "failed")
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .maybeSingle();
    if (queued.error) return sendError(c, mapDatabaseError(queued.error));
    if (!queued.data) {
      // Somebody else won the race. Their queue is the one that counts.
      const after = await db
        .from("documents")
        .select(DOCUMENT_SUMMARY_COLUMNS)
        .eq("organization_id", org.id)
        .eq("id", id)
        .single();
      if (after.error) return sendError(c, mapDatabaseError(after.error));
      return c.json(
        retryExtractionResponseSchema.parse({
          document: summarise(after.data as DocumentRow),
          retried: false,
        }),
      );
    }

    await emitEvent(db, deps.logger, {
      organizationId: org.id,
      eventType: "document.received",
      entityType: "document",
      entityId: id,
      actor: "user",
      actorUserId: user.id,
      payload: {
        kind: row.kind,
        filename: row.filename,
        clientId: row.client_id,
        workItemId: row.work_item_id,
        retry: true,
      },
    });

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "document.extraction_retried",
      objectType: "document",
      objectId: id,
      result: "success",
      previousState: { extraction_state: "failed", reason: row.extraction_error },
      newState: { extraction_state: "queued" },
    });

    return c.json(
      retryExtractionResponseSchema.parse({
        document: summarise(queued.data as DocumentRow),
        retried: true,
      }),
    );
  });

  /**
   * A person's decision about one extracted field (Phase 3's extraction review, required by its
   * gate). Accepting a figure off a schedule is a business action, so it is audited with what it
   * was and what it became.
   */
  app.post("/documents/:id/fields/:fieldId/review", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = reviewFieldRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "A decision is required.");
    const { decision, value } = parsed.data;
    if (decision === "correct" && !value) {
      throw new HttpError(400, "validation_failed", "A correction needs the corrected value.");
    }

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    // Reviewing extraction changes what the brokerage believes a document says, so it is gated
    // like other record writes rather than open to anyone who can read the file. The denial is
    // audited: a refused attempt is part of the history (§45 rule 15).
    // `document:edit`, from the 0005 catalogue, rather than a new verb: reviewing extraction
    // edits what the brokerage records the document as saying. Inventing a verb outside the
    // catalogue would leave every existing role grant silently not covering it.
    if (!hasPermission(ctx, "document", "edit")) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "document.field_review",
        objectType: "document_field",
        objectId: c.req.param("fieldId"),
        result: "denied",
        failureReason: "missing document:edit",
      });
      throw new HttpError(403, "forbidden", "Your role cannot review extracted values.");
    }

    const { data, error } = await db
      .from("document_fields")
      .select(DOCUMENT_FIELD_COLUMNS)
      .eq("organization_id", org.id)
      .eq("document_id", c.req.param("id"))
      .eq("id", c.req.param("fieldId"))
      .maybeSingle();
    if (error) return sendError(c, mapDatabaseError(error));
    if (!data) throw new HttpError(404, "not_found", "That field is not available.");
    const before = toField(data as FieldRow);

    /*
     * The same decision twice is one decision.
     *
     * Accept is a button a person double-clicks — on a slow connection, deliberately. Without this
     * the second click writes a second audit event saying the value changed from accepted to
     * accepted, which is noise in the one record that is supposed to be trustworthy. A *different*
     * decision is not a repeat and does go through: correcting an accepted value is a real change.
     */
    const repeat =
      (decision === "accept" && before.state === "accepted") ||
      (decision === "reject" && before.state === "rejected") ||
      (decision === "correct" && before.state === "corrected" && before.correctedValue === value);
    if (repeat) {
      return c.json(reviewFieldResponseSchema.parse({ field: before }));
    }

    const now = new Date().toISOString();
    const patch =
      decision === "correct"
        ? { state: "corrected", corrected_value: value, condition: "known" }
        : decision === "accept"
          ? { state: "accepted", condition: "known" }
          // A rejected field is not a corrected one: nothing is now known, and the UI says so.
          : { state: "rejected", condition: "missing" };

    const { data: updated, error: updateErr } = await db
      .from("document_fields")
      .update({ ...patch, reviewed_by: user.id, reviewed_at: now })
      .eq("id", before.id)
      .select(DOCUMENT_FIELD_COLUMNS)
      .single();
    if (updateErr) return sendError(c, mapDatabaseError(updateErr));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: `document.field_${decision}ed`,
      objectType: "document_field",
      objectId: before.id,
      result: "success",
      previousState: { state: before.state, value: before.correctedValue ?? before.proposedValue },
      newState: { state: patch.state, value: value ?? before.proposedValue },
    });

    return c.json(reviewFieldResponseSchema.parse({ field: toField(updated as FieldRow) }));
  });

  /* ---- Applying a document to the record it is about (D-077) -------------------------------- */

  /**
   * The records this document might be about, and why.
   *
   * **Never a guess presented as an answer.** Every suggestion names what the link rests on, and
   * carries one of the six evidence conditions: `known` when the document is already filed
   * against the record, `inferred` when it was matched on something the document says. A person
   * confirms or changes it; nothing is applied from here.
   *
   * When there is nothing to suggest the answer says why, because "no suggestions" and "could not
   * look" are different situations and a blank list cannot tell them apart.
   */
  app.get("/documents/:id/apply-targets", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const found = await db
      .from("documents")
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (found.error) return sendError(c, mapDatabaseError(found.error));
    if (!found.data) throw new HttpError(404, "not_found", "No document with that id");
    const doc = found.data as DocumentRow;

    const fieldsRes = await db
      .from("document_fields")
      .select(DOCUMENT_FIELD_COLUMNS)
      .eq("organization_id", org.id)
      .eq("document_id", id);
    if (fieldsRes.error) return sendError(c, mapDatabaseError(fieldsRes.error));
    const fields = ((fieldsRes.data ?? []) as FieldRow[]).map(toField);
    const valueOf = (key: string) =>
      fields.find((f) => f.fieldKey === key && f.state !== "rejected")?.correctedValue ??
      fields.find((f) => f.fieldKey === key && f.state !== "rejected")?.proposedValue ??
      null;

    const suggestions: ApplyTarget[] = [];

    /*
     * The strongest link first, and it is not a match at all: a document filed against a work
     * item already belongs to that work item's period of cover. Nothing was inferred.
     */
    if (doc.work_item_id) {
      const wi = await db
        .from("work_items")
        .select("id, title, policy_period_id")
        .eq("organization_id", org.id)
        .eq("id", doc.work_item_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!wi.error && wi.data) {
        const row = wi.data as { id: string; title: string; policy_period_id: string | null };
        if (row.policy_period_id) {
          const label = await periodLabel(db, org.id, row.policy_period_id);
          if (label) {
            suggestions.push({
              targetType: "policy_period",
              targetId: row.policy_period_id,
              label,
              reason: `This document is filed against the work "${row.title}", which is about this period of cover.`,
              condition: "known",
            });
          }
        }
      }
    }

    // A policy number the document states, matched against the brokerage's own policies. This is
    // a match on what the document says, so it is `inferred` and says so.
    const stated = valueOf("policy_number");
    if (stated) {
      const byNumber = await db
        .from("policies")
        .select("id, policy_number, class_of_business, client_id")
        .eq("organization_id", org.id)
        .eq("policy_number", stated)
        .is("deleted_at", null)
        .limit(5);
      if (!byNumber.error) {
        for (const row of (byNumber.data ?? []) as {
          id: string;
          policy_number: string | null;
          class_of_business: string;
        }[]) {
          suggestions.push({
            targetType: "policy",
            targetId: row.id,
            label: `${row.class_of_business} · ${row.policy_number ?? "no number"}`,
            reason: `The document states policy number ${stated}, which is this policy's number.`,
            condition: "inferred",
          });
          const periods = await db
            .from("policy_periods")
            .select("id, period_start, period_end")
            .eq("organization_id", org.id)
            .eq("policy_id", row.id)
            .order("period_start", { ascending: false })
            .limit(3);
          for (const p of (periods.data ?? []) as {
            id: string;
            period_start: string;
            period_end: string;
          }[]) {
            if (suggestions.some((s) => s.targetId === p.id)) continue;
            const label = await periodLabel(db, org.id, p.id);
            if (label) {
              suggestions.push({
                targetType: "policy_period",
                targetId: p.id,
                label,
                reason: `A period of cover on the policy whose number the document states.`,
                condition: "inferred",
              });
            }
          }
        }
      }
    }

    // The client the document is already filed against.
    if (doc.client_id) {
      const client = await db
        .from("clients")
        .select("id, name")
        .eq("organization_id", org.id)
        .eq("id", doc.client_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!client.error && client.data) {
        const row = client.data as { id: string; name: string };
        suggestions.push({
          targetType: "client",
          targetId: row.id,
          label: row.name,
          reason: "This document is filed against this client.",
          condition: "known",
        });
      }
    }

    /*
     * Why there is nothing, when there is nothing. §45 rule 8: a name on a schedule is not
     * identification, so an insured name alone never becomes a suggested client — that is the
     * inference the rule exists to forbid, and saying so is more use to a person than silence.
     */
    let whyNoTarget: string | null = null;
    if (suggestions.length === 0) {
      whyNoTarget = !doc.client_id && !doc.work_item_id && !stated
        ? "This document is not filed against a client or a piece of work, and it does not state a policy number ASAP recognises. Choose the record it belongs to, or create one."
        : stated
          ? `No policy in this brokerage has the number ${stated}. Choose the record it belongs to, or create one.`
          : "Nothing links this document to a record yet. ASAP will not match a client by name alone.";
    }

    return c.json(
      applyTargetsResponseSchema.parse({
        suggestions,
        whyNoTarget,
        applicableFields: APPLICABLE_FIELDS,
      }),
    );
  });

  /**
   * What applying would change, before anything is written.
   *
   * Every field the target accepts: what the record holds now, what would be written, whether
   * that is a change at all, and — for a field the document gave but this target cannot take —
   * why not. Fields the target accepts and the document never gave are listed as missing rather
   * than left out, because an absence a person cannot see is one they will assume away.
   */
  app.get("/documents/:id/apply-preview", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const parsedType = ApplyTargetType.safeParse(c.req.query("targetType"));
    const targetId = c.req.query("targetId") ?? "";
    if (!parsedType.success || !UUID.test(targetId)) {
      throw new HttpError(400, "validation_failed", "A target type and target id are required.");
    }
    const targetType = parsedType.data;
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const found = await db
      .from("documents")
      .select(DOCUMENT_SUMMARY_COLUMNS)
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (found.error) return sendError(c, mapDatabaseError(found.error));
    if (!found.data) throw new HttpError(404, "not_found", "No document with that id");

    const current = await currentValues(db, org.id, targetType, targetId);
    if (!current) throw new HttpError(404, "not_found", "No record of that kind with that id.");

    const fieldsRes = await db
      .from("document_fields")
      .select(DOCUMENT_FIELD_COLUMNS)
      .eq("organization_id", org.id)
      .eq("document_id", id);
    if (fieldsRes.error) return sendError(c, mapDatabaseError(fieldsRes.error));
    const fields = ((fieldsRes.data ?? []) as FieldRow[]).map(toField);
    const accepts = APPLICABLE_FIELDS[targetType];

    const rows: ApplyPreviewField[] = fields
      .filter((f) => f.state !== "rejected")
      .map((f) => {
        const proposed = f.correctedValue ?? f.proposedValue;
        const held = current.values[f.fieldKey] ?? null;
        const applicable = accepts.includes(f.fieldKey);
        return {
          documentFieldId: f.id,
          fieldKey: f.fieldKey,
          currentValue: held,
          proposedValue: proposed,
          page: f.page,
          region: f.region,
          condition: f.condition,
          state: f.state,
          unchanged: applicable && sameValue(f.fieldKey, held, proposed),
          blockedBecause: applicable
            ? proposed === null
              ? "The document gave no value for this."
              : null
            : `A ${targetType.replace(/_/g, " ")} does not hold this.`,
        };
      });

    return c.json(
      applyPreviewResponseSchema.parse({
        target: {
          targetType,
          targetId,
          label: current.label,
          reason: "Chosen by you.",
          condition: "known",
        },
        fields: rows,
        missing: accepts.filter((key) => !rows.some((r) => r.fieldKey === key && r.proposedValue)),
      }),
    );
  });

  /**
   * Write the chosen values to the named record.
   *
   * The whole write is one database transaction inside a definer function (0043), because the
   * three things that make this safe have to happen together or not at all: the record still
   * holding what the person was shown, the record changing, and the receipt that says it did.
   *
   * The browser never writes a business table. It sends a target, the fields, what each field
   * held when it was shown, and one key for one press of Apply.
   */
  app.post("/documents/:id/apply", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const parsed = applyRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(
        400,
        "validation_failed",
        "A target, at least one field and an idempotency key are required.",
      );
    }
    const req = parsed.data;
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    /*
     * Applying changes a business record, so it is gated on editing that record — not on
     * `document:edit`, which is permission to review what a document says. Reviewing a premium
     * and writing it onto a policy period are different powers.
     */
    const verbFor: Record<ApplyTargetTypeValue, { object: string; verb: string }> = {
      policy_period: { object: "policy", verb: "edit" },
      policy: { object: "policy", verb: "edit" },
      client: { object: "client", verb: "edit" },
    };
    const needed = verbFor[req.targetType];
    if (!hasPermission(ctx, needed.object, needed.verb)) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "document.apply_to_record",
        objectType: req.targetType,
        objectId: req.targetId,
        result: "denied",
        failureReason: `missing ${needed.object}:${needed.verb}`,
      });
      throw new HttpError(
        403,
        "forbidden",
        `Your role cannot change a ${req.targetType.replace(/_/g, " ")}.`,
      );
    }

    // Only fields a person has decided on may be written: an unreviewed reading is still a
    // proposal, and §45 rule 8 does not let a proposal become a business value on its own.
    const fieldsRes = await db
      .from("document_fields")
      .select(DOCUMENT_FIELD_COLUMNS)
      .eq("organization_id", org.id)
      .eq("document_id", id);
    if (fieldsRes.error) return sendError(c, mapDatabaseError(fieldsRes.error));
    const known = new Map(((fieldsRes.data ?? []) as FieldRow[]).map(toField).map((f) => [f.id, f]));
    for (const f of req.fields) {
      const row = known.get(f.documentFieldId);
      if (!row) throw new HttpError(404, "not_found", "That extracted value is not available.");
      if (row.state === "proposed") {
        throw new HttpError(
          409,
          "not_reviewed",
          "Accept or correct a value before applying it to a record.",
        );
      }
      if (row.state === "rejected") {
        throw new HttpError(409, "rejected_value", "A rejected value cannot be applied.");
      }
      if (!APPLICABLE_FIELDS[req.targetType].includes(f.fieldKey)) {
        throw new HttpError(
          422,
          "field_not_applicable",
          `A ${req.targetType.replace(/_/g, " ")} does not hold ${f.fieldKey.replace(/_/g, " ")}.`,
        );
      }
    }

    const rpc = await db.rpc("document_apply_to_record", {
      p_document_id: id,
      p_target_type: req.targetType,
      p_target_id: req.targetId,
      p_changes: req.fields.map((f) => ({
        field_key: f.fieldKey,
        document_field_id: f.documentFieldId,
        from: f.from,
        to: f.to,
        page: known.get(f.documentFieldId)?.page ?? null,
        premium_basis: f.premiumBasis ?? null,
        premium_currency: f.premiumCurrency ?? null,
      })),
      p_idempotency_key: req.idempotencyKey,
    });
    if (rpc.error) {
      const message = String(rpc.error.message ?? "");
      if (message.includes("stale_target")) {
        throw new HttpError(
          409,
          "stale_target",
          "This record has changed since you looked. Nothing was written — open it again to see what it holds now.",
        );
      }
      if (message.includes("document_not_found") || message.includes("target_not_found")) {
        throw new HttpError(404, "not_found", "That record is not available.");
      }
      if (message.includes("not_a_member")) {
        throw new HttpError(403, "forbidden", "That record belongs to another brokerage.");
      }
      if (message.includes("amount_not_a_number")) {
        throw new HttpError(
          422,
          "amount_not_a_number",
          "That figure could not be read as an amount. Correct it before applying — nothing was written.",
        );
      }
      if (message.includes("premium_basis_required")) {
        throw new HttpError(
          422,
          "premium_basis_required",
          "Say whether this figure is the gross premium or everything payable. A premium without a basis is a number without units, and the commission basis depends on which it is.",
        );
      }
      return sendError(c, mapDatabaseError(rpc.error));
    }

    const receipt = rpc.data as {
      application_id: string;
      target_type: string;
      target_id: string;
      changes: { field_key: string; document_field_id: string | null; from: string | null; to: string; page: number | null }[];
      applied_at: string;
      repeat: boolean;
    };

    return c.json(
      applyResponseSchema.parse({
        applicationId: receipt.application_id,
        targetType: receipt.target_type,
        targetId: receipt.target_id,
        appliedAt: receipt.applied_at,
        changes: (receipt.changes ?? []).map((ch) => ({
          fieldKey: ch.field_key,
          documentFieldId: ch.document_field_id,
          from: ch.from,
          to: ch.to,
          page: ch.page,
        })),
        repeat: receipt.repeat,
      }),
    );
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
