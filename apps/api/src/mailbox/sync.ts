import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { emitEvent } from "../events/emit.js";
import { decryptToken, encryptToken } from "./crypto.js";
import type { FetchedMessage, MailboxCredentials, MailboxProvider, SyncLimits } from "./types.js";

/**
 * Reading a mailbox, under control.
 *
 * The shape of this function is decided by four things going wrong in ways that are expensive:
 *
 *  1. **A first sync that reads everything.** A brokerage's mailbox holds years. One pass reads a
 *     bounded window and a bounded number of messages, records where it got to, and stops. More
 *     passes are more events, which is a thing the system already knows how to do safely.
 *  2. **The same message arriving twice.** Every write is keyed on the provider's own identity —
 *     `(mailbox, provider_thread_id)` for a thread, `(thread, provider_message_id)` for a message,
 *     `(message, provider_attachment_id)` for an attachment. A second pass over the same mail
 *     updates rather than duplicates, and this holds for a retried event, a double-clicked
 *     button, and a worker that restarted half way.
 *  3. **A later page failing and taking the earlier ones with it.** Nothing is rolled back. What
 *     was saved stays saved; the run records what it managed, and the checkpoint is only advanced
 *     when the pass completed — so a resume re-reads a little rather than skipping mail.
 *  4. **A stale worker moving the checkpoint backwards.** The cursor write is conditional on the
 *     cursor not having been written since this run read it. A slow pass cannot undo a fast one.
 *
 * And one thing that is not a failure mode but a rule: an attachment enters the ordinary document
 * pipeline. It is stored in the tenant's own bucket, gets a document row, and emits
 * `document.received` — which is what makes it readable, reviewable and applied by a person like
 * any other file. It is never treated as read because it arrived.
 */

export type SyncOutcome = {
  runId: string;
  state: "succeeded" | "failed";
  threadsSeen: number;
  messagesSaved: number;
  attachmentsSaved: number;
  /** True when this pass stopped at a limit and there is more waiting. */
  moreWaiting: boolean;
  checkpointExpired: boolean;
  error: string | null;
};

export type SyncDeps = {
  db: SupabaseClient;
  logger: Logger;
  provider: MailboxProvider;
  encryptionKey: string;
  bucket: string;
  limits: SyncLimits;
};

type MailboxRow = {
  id: string;
  organization_id: string;
  provider: "gmail" | "microsoft";
  email_address: string;
  status: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  sync_cursor: string | null;
  sync_cursor_updated_at: string | null;
};

/**
 * One pass.
 *
 * `trigger` says who asked, so the history can tell a first connection from a person pressing
 * "read it again" from a schedule. It is on the run row, not in a log line.
 */
export async function syncMailbox(
  deps: SyncDeps,
  input: { mailboxId: string; trigger: "first_connection" | "person" | "schedule" },
): Promise<SyncOutcome> {
  const { db, logger } = deps;

  const boxQ = await db
    .from("mailboxes")
    .select(
      "id, organization_id, provider, email_address, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, sync_cursor, sync_cursor_updated_at",
    )
    .eq("id", input.mailboxId)
    .maybeSingle();
  if (boxQ.error || !boxQ.data) {
    throw new Error("The mailbox could not be read.");
  }
  const box = boxQ.data as MailboxRow;

  if (box.status === "disconnected") {
    throw new Error("This mailbox is disconnected. Nothing was read.");
  }

  /*
   * One pass at a time. The partial unique index refuses a second running row, so a double-clicked
   * button or a re-delivered event finds the pass that is already going instead of racing it.
   */
  const started = await db
    .from("mailbox_sync_runs")
    .insert({
      organization_id: box.organization_id,
      mailbox_id: box.id,
      state: "running",
      trigger: input.trigger,
      cursor_before: box.sync_cursor,
    })
    .select("id")
    .maybeSingle();
  if (started.error || !started.data) {
    throw new AlreadySyncing("This mailbox is already being read.");
  }
  const runId = (started.data as { id: string }).id;

  let threadsSeen = 0;
  let messagesSaved = 0;
  let attachmentsSaved = 0;

  try {
    const credentials = await usableCredentials(deps, box);
    if (credentials === "needs_reauthorisation") {
      await markNeedsReauthorisation(deps, box);
      return await finishRun(deps, runId, {
        state: "failed",
        threadsSeen,
        messagesSaved,
        attachmentsSaved,
        cursorAfter: null,
        checkpointExpired: false,
        moreWaiting: false,
        error: "This mailbox needs authorising again before anything can be read.",
      });
    }

    const page = await deps.provider.list({
      credentials,
      cursor: box.sync_cursor,
      limits: deps.limits,
    });

    let attachmentBudget = deps.limits.maxAttachments;
    const threadIds = new Map<string, string>();

    for (const message of page.messages) {
      const threadId =
        threadIds.get(message.providerThreadId) ??
        (await upsertThread(deps, box, message));
      if (!threadIds.has(message.providerThreadId)) {
        threadIds.set(message.providerThreadId, threadId);
        threadsSeen += 1;
      }

      const saved = await upsertMessage(deps, box, threadId, message);
      if (saved === null) continue;
      // Already on file is not saved. The count is what this pass added, not what it looked at.
      if (saved.created) messagesSaved += 1;
      const messageId = saved.id;

      for (const attachment of message.attachments) {
        if (attachmentBudget <= 0) break;
        const filed = await ingestAttachment(deps, box, {
          messageId,
          providerMessageId: message.providerMessageId,
          attachment,
        });
        if (filed === "saved") {
          attachmentsSaved += 1;
          attachmentBudget -= 1;
        }
      }
    }

    /*
     * The checkpoint moves only now, and only if nobody has moved it since this pass read it.
     * A pass that saved nothing still advances it — "nothing changed" is a real answer — but a
     * pass that failed does not get here at all.
     */
    const cursorAfter = await advanceCursor(deps, box, page.cursor);

    return await finishRun(deps, runId, {
      state: "succeeded",
      threadsSeen,
      messagesSaved,
      attachmentsSaved,
      cursorAfter,
      checkpointExpired: page.checkpointExpired,
      moreWaiting: page.reachedLimit,
      error: null,
    });
  } catch (e) {
    const reason = plainReason(e);
    logger.error({ mailboxId: box.id, runId }, "a mailbox pass failed");
    /*
     * Nothing already saved is undone. The messages that arrived are the brokerage's own
     * correspondence, and deleting them because a later page failed would lose real work.
     */
    return await finishRun(deps, runId, {
      state: "failed",
      threadsSeen,
      messagesSaved,
      attachmentsSaved,
      cursorAfter: null,
      checkpointExpired: false,
      moreWaiting: false,
      error: reason,
    });
  }
}

/** Raised when a pass is already going. Not an error to report: it is the right answer. */
export class AlreadySyncing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadySyncing";
  }
}

/**
 * A usable access token, refreshing it first when it has expired.
 *
 * The refreshed token is written back encrypted, so the next pass does not refresh again. A
 * refusal is not retried: it means the brokerage revoked access or Google expired the grant, and
 * only a person can fix that.
 */
async function usableCredentials(
  deps: SyncDeps,
  box: MailboxRow,
): Promise<MailboxCredentials | "needs_reauthorisation"> {
  const access = box.access_token_encrypted
    ? decryptToken(box.access_token_encrypted, deps.encryptionKey)
    : null;
  const refresh = box.refresh_token_encrypted
    ? decryptToken(box.refresh_token_encrypted, deps.encryptionKey)
    : null;
  if (access === null && refresh === null) return "needs_reauthorisation";

  const expired =
    box.token_expires_at !== null && new Date(box.token_expires_at).getTime() <= Date.now() + 60_000;
  if (access !== null && !expired) {
    return { accessToken: access, refreshToken: refresh, expiresAt: box.token_expires_at };
  }

  const refreshed = await deps.provider.refresh({
    accessToken: access ?? "",
    refreshToken: refresh,
    expiresAt: box.token_expires_at,
  });
  if (refreshed === "needs_reauthorisation") return "needs_reauthorisation";

  await deps.db
    .from("mailboxes")
    .update({
      access_token_encrypted: encryptToken(refreshed.accessToken, deps.encryptionKey),
      token_expires_at: refreshed.expiresAt,
      status: "connected",
      status_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", box.id);

  return refreshed;
}

async function markNeedsReauthorisation(deps: SyncDeps, box: MailboxRow): Promise<void> {
  await deps.db
    .from("mailboxes")
    .update({
      status: "needs_reauthorisation",
      status_reason: "Google would not renew the authorisation. Connect the mailbox again.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", box.id);
}

/** The conversation this message belongs to, by the provider's own thread id. */
async function upsertThread(
  deps: SyncDeps,
  box: MailboxRow,
  message: FetchedMessage,
): Promise<string> {
  const existing = await deps.db
    .from("email_threads")
    .select("id, last_message_at")
    .eq("organization_id", box.organization_id)
    .eq("mailbox_id", box.id)
    .eq("provider_thread_id", message.providerThreadId)
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as { id: string; last_message_at: string | null };
    // The thread's own latest time only ever moves forward.
    if (row.last_message_at === null || row.last_message_at < message.sentAt) {
      await deps.db
        .from("email_threads")
        .update({ last_message_at: message.sentAt })
        .eq("id", row.id);
    }
    return row.id;
  }

  const inserted = await deps.db
    .from("email_threads")
    .insert({
      organization_id: box.organization_id,
      mailbox_id: box.id,
      provider_thread_id: message.providerThreadId,
      subject: message.subject,
      last_message_at: message.sentAt,
    })
    .select("id")
    .maybeSingle();
  if (inserted.error || !inserted.data) {
    /*
     * Another pass inserted it between the read and the write. The unique constraint refused this
     * one, which is the point of it — read the row that won rather than failing the message.
     */
    const again = await deps.db
      .from("email_threads")
      .select("id")
      .eq("organization_id", box.organization_id)
      .eq("mailbox_id", box.id)
      .eq("provider_thread_id", message.providerThreadId)
      .maybeSingle();
    if (!again.data) throw new Error("The conversation could not be saved.");
    return (again.data as { id: string }).id;
  }
  return (inserted.data as { id: string }).id;
}

/**
 * The message, by the provider's own id.
 *
 * `created` is the difference between a pass that read forty messages and a pass that saved
 * forty: on a second look at the same mail nothing is written, and the run row must say so rather
 * than reporting the same forty again.
 */
async function upsertMessage(
  deps: SyncDeps,
  box: MailboxRow,
  threadId: string,
  message: FetchedMessage,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await deps.db
    .from("email_messages")
    .select("id")
    .eq("organization_id", box.organization_id)
    .eq("thread_id", threadId)
    .eq("provider_message_id", message.providerMessageId)
    .maybeSingle();
  if (existing.data) return { id: (existing.data as { id: string }).id, created: false };

  const inserted = await deps.db
    .from("email_messages")
    .insert({
      organization_id: box.organization_id,
      thread_id: threadId,
      provider_message_id: message.providerMessageId,
      direction: message.direction,
      from_address: message.from,
      to_addresses: message.to,
      cc_addresses: message.cc,
      subject: message.subject,
      body_text: message.bodyText,
      snippet: message.snippet,
      sent_at: message.sentAt,
      has_attachments: message.attachments.length > 0,
    })
    .select("id")
    .maybeSingle();
  if (inserted.error || !inserted.data) return null;
  return { id: (inserted.data as { id: string }).id, created: true };
}

/**
 * An attachment into the ordinary document pipeline.
 *
 * The attachment row is written whatever happens, so a person can see that the message carried a
 * file even when this deployment would not file it. The bytes are fetched only for a type and a
 * size worth filing, and the document is keyed on its own content digest — so the same attachment
 * on a second pass, or the same schedule sent twice, is one document.
 */
async function ingestAttachment(
  deps: SyncDeps,
  box: MailboxRow,
  input: {
    messageId: string;
    providerMessageId: string;
    attachment: FetchedMessage["attachments"][number];
  },
): Promise<"saved" | "recorded" | "already"> {
  const { attachment } = input;

  const existing = await deps.db
    .from("email_attachments")
    .select("id, document_id")
    .eq("organization_id", box.organization_id)
    .eq("message_id", input.messageId)
    .eq("provider_attachment_id", attachment.providerAttachmentId ?? "")
    .maybeSingle();
  if (existing.data && (existing.data as { document_id: string | null }).document_id !== null) {
    return "already";
  }

  const attachmentRowId =
    (existing.data as { id: string } | null)?.id ??
    ((
      await deps.db
        .from("email_attachments")
        .insert({
          organization_id: box.organization_id,
          message_id: input.messageId,
          provider_attachment_id: attachment.providerAttachmentId,
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          byte_size: attachment.byteSize,
        })
        .select("id")
        .maybeSingle()
    ).data as { id: string } | null)?.id ??
    null;
  if (attachmentRowId === null) return "recorded";

  const filable =
    attachment.providerAttachmentId !== null &&
    deps.limits.attachmentMimeTypes.includes(attachment.mimeType) &&
    attachment.byteSize > 0 &&
    attachment.byteSize <= deps.limits.maxAttachmentBytes;
  if (!filable) return "recorded";

  const bytes = await deps.provider.fetchAttachment({
    credentials: await mustCredentials(deps, box),
    providerMessageId: input.providerMessageId,
    providerAttachmentId: attachment.providerAttachmentId!,
  });
  if (bytes === null) return "recorded";

  const contentSha256 = createHash("sha256").update(bytes).digest("hex");

  /* The same bytes are the same document, whether they arrived by email or by hand. */
  const onFile = await deps.db
    .from("documents")
    .select("id")
    .eq("organization_id", box.organization_id)
    .eq("content_sha256", contentSha256)
    .is("deleted_at", null)
    .maybeSingle();

  let documentId = (onFile.data as { id: string } | null)?.id ?? null;

  if (documentId === null) {
    documentId = crypto.randomUUID();
    const storagePath = `${box.organization_id}/email/${input.messageId}/${documentId}/${safeName(attachment.filename)}`;
    const upload = await deps.db.storage
      .from(deps.bucket)
      .upload(storagePath, bytes, { contentType: attachment.mimeType, upsert: true });
    if (upload.error) return "recorded";

    const inserted = await deps.db
      .from("documents")
      .insert({
        id: documentId,
        organization_id: box.organization_id,
        kind: "other",
        filename: attachment.filename,
        mime_type: attachment.mimeType,
        byte_size: attachment.byteSize,
        storage_path: storagePath,
        content_sha256: contentSha256,
        /* Whose authorisation the mailbox runs on: the real actor behind an automatic file. */
        uploaded_by: null,
        extraction_state: "queued",
      })
      .select("id")
      .maybeSingle();
    if (inserted.error || !inserted.data) return "recorded";

    await emitEvent(deps.db, deps.logger, {
      organizationId: box.organization_id,
      eventType: "document.received",
      entityType: "document",
      entityId: documentId,
      actor: "automation",
      /*
       * Nobody pressed anything: this file arrived because a mailbox a person connected was read.
       * The audit trail for that connection carries the person; this row carries the truth that
       * no human filed it.
       */
      actorUserId: null,
      payload: {
        kind: "other",
        filename: attachment.filename,
        source: "email",
        emailMessageId: input.messageId,
      },
    });
  }

  await deps.db
    .from("email_attachments")
    .update({ document_id: documentId })
    .eq("id", attachmentRowId);

  return "saved";
}

/** The credentials for an attachment fetch. The pass already established they are usable. */
async function mustCredentials(deps: SyncDeps, box: MailboxRow): Promise<MailboxCredentials> {
  const fresh = await deps.db
    .from("mailboxes")
    .select("access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("id", box.id)
    .maybeSingle();
  const row = (fresh.data ?? {}) as {
    access_token_encrypted?: string | null;
    refresh_token_encrypted?: string | null;
    token_expires_at?: string | null;
  };
  return {
    accessToken: row.access_token_encrypted
      ? (decryptToken(row.access_token_encrypted, deps.encryptionKey) ?? "")
      : "",
    refreshToken: row.refresh_token_encrypted
      ? decryptToken(row.refresh_token_encrypted, deps.encryptionKey)
      : null,
    expiresAt: row.token_expires_at ?? null,
  };
}

/**
 * Move the checkpoint, unless somebody moved it after this pass read it.
 *
 * The condition is the guard: a slow pass that finishes after a fast one must not rewind the
 * mailbox to where it was, because everything between would be read again — or, worse, a later
 * pass would start from a point that has already been consumed.
 */
async function advanceCursor(
  deps: SyncDeps,
  box: MailboxRow,
  cursor: string | null,
): Promise<string | null> {
  if (cursor === null || cursor === box.sync_cursor) return box.sync_cursor;

  const now = new Date().toISOString();
  let q = deps.db
    .from("mailboxes")
    .update({
      sync_cursor: cursor,
      sync_cursor_updated_at: now,
      last_synced_at: now,
      updated_at: now,
    })
    .eq("id", box.id);
  q =
    box.sync_cursor_updated_at === null
      ? q.is("sync_cursor_updated_at", null)
      : q.eq("sync_cursor_updated_at", box.sync_cursor_updated_at);

  const written = await q.select("sync_cursor").maybeSingle();
  if (written.error || !written.data) {
    // Somebody newer got there first. Their checkpoint stands; this pass simply did not move it.
    return box.sync_cursor;
  }
  return cursor;
}

async function finishRun(
  deps: SyncDeps,
  runId: string,
  outcome: {
    state: "succeeded" | "failed";
    threadsSeen: number;
    messagesSaved: number;
    attachmentsSaved: number;
    cursorAfter: string | null;
    checkpointExpired: boolean;
    moreWaiting: boolean;
    error: string | null;
  },
): Promise<SyncOutcome> {
  await deps.db
    .from("mailbox_sync_runs")
    .update({
      state: outcome.state,
      finished_at: new Date().toISOString(),
      threads_seen: outcome.threadsSeen,
      messages_saved: outcome.messagesSaved,
      attachments_saved: outcome.attachmentsSaved,
      cursor_after: outcome.cursorAfter,
      checkpoint_expired: outcome.checkpointExpired,
      error: outcome.error,
    })
    .eq("id", runId);

  return {
    runId,
    state: outcome.state,
    threadsSeen: outcome.threadsSeen,
    messagesSaved: outcome.messagesSaved,
    attachmentsSaved: outcome.attachmentsSaved,
    moreWaiting: outcome.moreWaiting,
    checkpointExpired: outcome.checkpointExpired,
    error: outcome.error,
  };
}

/**
 * A failure in words a person can act on.
 *
 * Deliberately not the provider's own message: those carry request urls, tokens in query strings
 * and, for a message endpoint, fragments of the brokerage's own correspondence.
 */
function plainReason(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 429) return "Google asked us to slow down. Nothing more was read this time.";
  if (typeof status === "number" && status >= 500) {
    return "Google could not be reached. Nothing more was read this time.";
  }
  if (typeof status === "number" && (status === 401 || status === 403)) {
    return "Google refused the authorisation. The mailbox needs connecting again.";
  }
  return "The mailbox could not be read. What had already arrived was kept.";
}

/** A filename safe for a storage key, keeping enough of the original to recognise it. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(-120);
  return cleaned === "" ? "attachment" : cleaned;
}
