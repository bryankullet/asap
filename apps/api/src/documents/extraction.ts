import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { ExtractorUnavailable, type Extractor } from "./extractor.js";

/**
 * Reading a filed document, and proposing what it says.
 *
 * Runs when `document.received` is dispatched. It is the step that makes "ASAP reads it next" —
 * which the upload screen says — actually true.
 *
 * **Nothing here decides anything.** Pages and their text are facts about the file; every field is
 * a *proposal* with an evidence condition, written as `state = 'proposed'`, and a person accepts
 * or corrects each one before any of it counts as known (§45 rule 8). A value that reached a
 * record without somebody accepting it would be exactly the defect the review screen exists to
 * prevent.
 */

export type ExtractionOutcome =
  | { state: "extracted"; pages: number; fields: number }
  | { state: "failed"; reason: string }
  | { state: "skipped"; reason: string };

export async function extractDocument(
  db: SupabaseClient,
  logger: Logger,
  extractor: Extractor | null,
  bucket: string,
  documentId: string,
): Promise<ExtractionOutcome> {
  if (!extractor) {
    return {
      state: "skipped",
      reason: "This deployment has no extraction service configured, so nothing was read.",
    };
  }

  const found = await db
    .from("documents")
    .select("id, organization_id, filename, mime_type, storage_path, extraction_state")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error || !found.data) {
    return { state: "failed", reason: "The document could not be read from the database." };
  }
  const doc = found.data as {
    id: string;
    organization_id: string;
    filename: string;
    mime_type: string;
    storage_path: string;
    extraction_state: string;
  };

  /*
   * Only a document that is waiting to be read. A dispatcher that delivered the same event twice
   * would otherwise re-read a document and replace a person's accepted values with fresh
   * proposals — which is the one thing extraction must never do.
   */
  if (doc.extraction_state !== "queued") {
    return { state: "skipped", reason: `The document is ${doc.extraction_state}, not waiting to be read.` };
  }

  await db.from("documents").update({ extraction_state: "working" }).eq("id", doc.id);

  const file = await db.storage.from(bucket).download(doc.storage_path);
  if (file.error || !file.data) {
    return await fail(db, doc.id, "The file could not be read from storage.");
  }

  let result;
  try {
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    result = await extractor.extract({
      bytes,
      mimeType: doc.mime_type,
      filename: doc.filename,
    });
  } catch (e) {
    /*
     * An extractor that is down is a different fact from a document that cannot be read, and the
     * difference matters to whoever has to do something about it. Neither message carries a word
     * of the document's contents.
     */
    const reason =
      e instanceof ExtractorUnavailable
        ? "The service that reads documents could not be reached. The document is still on file."
        : "That document could not be read.";
    logger.error({ documentId: doc.id, kind: e instanceof ExtractorUnavailable ? "unavailable" : "unreadable" }, "extraction failed");
    return await fail(db, doc.id, reason);
  }

  // Pages first: they are the facts, and a field points at one of them.
  if (result.pages.length > 0) {
    const pages = await db.from("document_pages").upsert(
      result.pages.map((p) => ({
        organization_id: doc.organization_id,
        document_id: doc.id,
        page_number: p.pageNumber,
        text: p.text,
        width: p.width,
        height: p.height,
      })),
      { onConflict: "document_id,page_number" },
    );
    if (pages.error) return await fail(db, doc.id, "What was read could not be recorded.");
  }

  if (result.fields.length > 0) {
    const fields = await db.from("document_fields").insert(
      result.fields.map((f) => ({
        organization_id: doc.organization_id,
        document_id: doc.id,
        field_key: f.fieldKey,
        proposed_value: f.value,
        page_number: f.page,
        region_x: f.region?.x ?? null,
        region_y: f.region?.y ?? null,
        region_width: f.region?.width ?? null,
        region_height: f.region?.height ?? null,
        // Proposed, always. A person's acceptance is what turns a reading into a known value.
        state: "proposed",
        condition: f.condition,
      })),
    );
    if (fields.error) return await fail(db, doc.id, "What was read could not be recorded.");
  }

  const done = await db
    .from("documents")
    .update({
      extraction_state: "extracted",
      page_count: result.pages.length,
      extraction_error: null,
    })
    .eq("id", doc.id);
  if (done.error) return await fail(db, doc.id, "What was read could not be recorded.");

  return { state: "extracted", pages: result.pages.length, fields: result.fields.length };
}

/** Records why a document could not be read, in words a person can act on. */
async function fail(db: SupabaseClient, id: string, reason: string): Promise<ExtractionOutcome> {
  await db
    .from("documents")
    .update({ extraction_state: "failed", extraction_error: reason })
    .eq("id", id);
  return { state: "failed", reason };
}
