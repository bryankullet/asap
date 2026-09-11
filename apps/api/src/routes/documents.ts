import {
  DOCUMENT_FIELD_COLUMNS,
  DOCUMENT_PAGE_COLUMNS,
  documentDetailSchema,
  documentsResponseSchema,
  reviewFieldRequestSchema,
  reviewFieldResponseSchema,
  uploadRequestSchema,
  uploadResponseSchema,
  type DocumentField,
  type DocumentSummary,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
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
        "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, page_count, extraction_state, extraction_error, created_at",
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
      documentsResponseSchema.parse({ documents: ((data ?? []) as DocumentRow[]).map(summarise) }),
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
        "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, page_count, extraction_state, extraction_error, created_at",
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
        "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, page_count, extraction_state, extraction_error, created_at",
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
        "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, page_count, extraction_state, extraction_error, created_at",
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

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
