import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { emitEvent } from "../events/emit.js";
import { safeName } from "../routes/documents.js";
import type { ParsedAttachment } from "./eml.js";

/**
 * An attachment on a pasted .eml, filed as a document (D-144) — the same row, the same storage key
 * shape and the same `document.received` event as a person's upload, so the extractor reads it
 * and anything waiting for a document (an issuance run) sees it. The same bytes already on file
 * are the same document. If the file store cannot be reached, the row is withdrawn and the email
 * says the attachment was not kept: nothing half-filed.
 */
export type FiledAttachment = { filename: string; documentId: string | null; outcome: "filed" | "already_on_file" | "not_kept" };

export async function fileAttachments(db: SupabaseClient, logger: Logger, o: { organizationId: string; userId: string; bucket: string; emailMessageId: string; attachments: ParsedAttachment[] }): Promise<FiledAttachment[]> {
  const out: FiledAttachment[] = [];
  for (const a of o.attachments) {
    const sha = createHash("sha256").update(a.content).digest("hex");
    const existing = await db.from("documents").select("id").eq("organization_id", o.organizationId).eq("content_sha256", sha).is("deleted_at", null).maybeSingle();
    if (existing.data) {
      out.push({ filename: a.filename, documentId: (existing.data as { id: string }).id, outcome: "already_on_file" });
      continue;
    }
    const id = randomUUID();
    const path = `${o.organizationId}/email/${o.emailMessageId}/${id}/${safeName(a.filename)}`;
    const ins = await db.from("documents").insert({ id, organization_id: o.organizationId, kind: "other", filename: a.filename, mime_type: a.contentType, byte_size: a.content.length, storage_path: path, content_sha256: sha, uploaded_by: o.userId });
    if (ins.error) {
      logger.warn({ code: ins.error.code }, "an email attachment could not be filed");
      out.push({ filename: a.filename, documentId: null, outcome: "not_kept" });
      continue;
    }
    const stored = await db.storage.from(o.bucket).upload(path, a.content, { contentType: a.contentType, upsert: false }).then((up) => !up.error, () => false);
    if (!stored) {
      await db.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      out.push({ filename: a.filename, documentId: null, outcome: "not_kept" });
      continue;
    }
    await db.from("documents").update({ extraction_state: "queued", updated_at: new Date().toISOString() }).eq("id", id);
    await emitEvent(db, logger, { organizationId: o.organizationId, eventType: "document.received", entityType: "document", entityId: id, actor: "user", actorUserId: o.userId, payload: { kind: "other", filename: a.filename, clientId: null, workItemId: null, emailMessageId: o.emailMessageId } });
    out.push({ filename: a.filename, documentId: id, outcome: "filed" });
  }
  return out;
}
