import {
  MAILBOX_COLUMNS,
  MAILBOX_PROVIDER_LABELS,
  connectMailboxRequestSchema,
  connectMailboxResponseSchema,
  mailboxesResponseSchema,
  emailThreadsResponseSchema,
  emailThreadResponseSchema,
  linkEmailThreadRequestSchema,
  saveEmailDraftRequestSchema,
  type EmailThreadLinks,
  type MailboxProviderIdValue,
  type MailboxesResponse,
} from "@asap/schema";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailboxProvider } from "../mailbox/types.js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { emitEvent } from "../events/emit.js";
import { decryptToken, newOAuthState } from "../mailbox/crypto.js";
import { GMAIL_READ_SCOPES } from "../mailbox/providers/gmail.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * The mailbox the brokerage already works from (D-068).
 *
 * Two things this surface will not do:
 *
 *  - **It never returns a token.** The access and refresh tokens are encrypted, server-side, and
 *    no response shape here has anywhere to put one. A browser that could read a mailbox token
 *    could read the mailbox (§45 rule 4).
 *  - **It never pretends a provider is available.** A deployment without OAuth credentials says
 *    so, in words, at the moment somebody asks — rather than sending them to an authorisation
 *    page that cannot work.
 */
export type MailboxOAuthConfig = {
  gmail: {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    redirectUri?: string | undefined;
  };
  microsoft: {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    tenantId?: string | undefined;
    redirectUri?: string | undefined;
  };
};

/** What a provider still needs before anyone can connect one, in words rather than variable names. */
function missingFor(provider: MailboxProviderIdValue, config: MailboxOAuthConfig): string | null {
  if (provider === "gmail") {
    const c = config.gmail;
    return c.clientId && c.clientSecret && c.redirectUri
      ? null
      : "This deployment has no Google credentials yet. Whoever administers it can add them.";
  }
  const c = config.microsoft;
  return c.clientId && c.clientSecret && c.tenantId && c.redirectUri
    ? null
    : "This deployment has no Microsoft credentials yet. Whoever administers it can add them.";
}

/**
 * How long an authorisation may be in flight.
 *
 * Long enough for a person to read a consent screen and pick an account; short enough that a
 * state left in a browser history is useless by the time anyone finds it.
 */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type SyncRunRow = {
  id: string;
  mailbox_id: string;
  state: "running" | "succeeded" | "failed";
  error: string | null;
  started_at: string;
  finished_at: string | null;
  messages_saved: number;
  attachments_saved: number;
  cursor_after: string | null;
  checkpoint_expired: boolean;
};

type MailboxRow = {
  id: string;
  provider: MailboxProviderIdValue;
  email_address: string;
  display_name: string | null;
  status: "connected" | "needs_reauthorisation" | "disconnected";
  status_reason: string | null;
  sync_cursor: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export function mailboxRoutes(deps: {
  logger: Logger;
  oauth: MailboxOAuthConfig;
  /** The adapters, so a disconnect can tell the provider. Absent in a deployment with none. */
  providers?: Partial<Record<MailboxProviderIdValue, MailboxProvider>> | undefined;
  /** Server-side only, and used only to read a token back in order to revoke it. */
  encryptionKey?: string | undefined;
  /**
   * The service connection, for the one table no tenant path may reach.
   *
   * `mailbox_oauth_states` has row level security on and no policy at all: the callback that
   * consumes a state has no session, so the row cannot be tenant-readable without also being
   * listable by a signed-in person. It is therefore written here the same way it is read there.
   * The organization and the person on the row still come from the session, never from the body.
   */
  service?: (() => SupabaseClient) | undefined;
}) {
  const app = new Hono();

  /** What is connected, and what this deployment could connect. */
  /**
   * The brokerage's own correspondence, newest first.
   *
   * Read-only, under the caller's RLS. Nothing is sent from here: a message leaves ASAP only
   * through an approved draft, with the provider's own message id recorded against it.
   */
  app.get("/email/threads", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const boxes = await db.from("mailboxes").select("id").eq("organization_id", org.id).limit(1);
    if (boxes.error) return sendError(c, mapDatabaseError(boxes.error));

    const { data, error } = await db
      .from("email_threads")
      .select(
        "id, subject, client_id, work_item_id, last_message_at, clients(name), email_messages(count)",
      )
      .eq("organization_id", org.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) return sendError(c, mapDatabaseError(error));

    return c.json(
      emailThreadsResponseSchema.parse({
        mailboxConnected: (boxes.data ?? []).length > 0,
        threads: ((data ?? []) as ThreadRow[]).map(threadSummary),
      }),
    );
  });

  /**
   * One conversation, in full.
   *
   * The body is the brokerage's own correspondence: it is read here and shown, and it is never
   * copied into an audit row or a log line. Everything this returns is a row — the links were set
   * by a person, the suggestions say why they were suggested, and nothing claims a message was
   * sent that has no provider id behind it.
   */
  app.get("/email/threads/:id", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const thread = await db
      .from("email_threads")
      .select(
        "id, subject, client_id, policy_id, work_item_id, mailbox_id, last_message_at, created_at",
      )
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (thread.error) return sendError(c, mapDatabaseError(thread.error));
    if (!thread.data) throw new HttpError(404, "not_found", "No conversation with that id");
    const row = thread.data as ThreadRow;

    const messages = await db
      .from("email_messages")
      .select(
        "id, direction, from_address, to_addresses, cc_addresses, subject, body_text, snippet, sent_at, has_attachments, provider_message_id",
      )
      .eq("organization_id", org.id)
      .eq("thread_id", id)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (messages.error) return sendError(c, mapDatabaseError(messages.error));
    const msgs = (messages.data ?? []) as MessageRow[];

    const attachments = await db
      .from("email_attachments")
      .select("id, message_id, filename, mime_type, byte_size, provider_attachment_id, document_id")
      .eq("organization_id", org.id)
      .in(
        "message_id",
        msgs.map((m) => m.id),
      );
    if (attachments.error) return sendError(c, mapDatabaseError(attachments.error));
    const byMessage = new Map<string, AttachmentRow[]>();
    for (const a of (attachments.data ?? []) as AttachmentRow[]) {
      byMessage.set(a.message_id, [...(byMessage.get(a.message_id) ?? []), a]);
    }

    const mailbox = row.mailbox_id
      ? await db
          .from("mailboxes")
          .select("provider, email_address, status")
          .eq("organization_id", org.id)
          .eq("id", row.mailbox_id)
          .maybeSingle()
      : { data: null, error: null };
    if (mailbox.error) return sendError(c, mapDatabaseError(mailbox.error));
    const box = mailbox.data as MailboxAddressRow | null;

    const links = await resolveLinks(db, org.id, row);
    const draft = await readDraft(db, org.id, id);

    return c.json(
      emailThreadResponseSchema.parse({
        thread: {
          ...threadSummary({ ...row, email_messages: [{ count: msgs.length }] }),
          clientName: links.clientName,
          participants: participantsOf(msgs),
          provider: box?.provider ?? null,
          mailboxAddress: box?.email_address ?? null,
          mailboxStatus: box?.status ?? null,
          firstMessageAt: msgs[0]?.sent_at ?? null,
          unhandled: unhandledOf(msgs, links),
        },
        messages: msgs.map((m) => ({
          id: m.id,
          direction: m.direction,
          from: m.from_address,
          to: m.to_addresses ?? [],
          cc: m.cc_addresses ?? [],
          subject: m.subject,
          body: m.body_text,
          snippet: m.snippet,
          sentAt: m.sent_at,
          hasAttachments: m.has_attachments,
          providerMessageId: m.provider_message_id,
          /*
           * Where the original lives. Gmail addresses a message by its own id under the account
           * that holds it, so this opens the real thing rather than a copy of it. Only Gmail is
           * addressable this way today; anything else says so by being null.
           */
          providerUrl:
            box?.provider === "gmail"
              ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.provider_message_id)}`
              : null,
          attachments: (byMessage.get(m.id) ?? []).map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mime_type,
            byteSize: a.byte_size,
            providerAttachmentId: a.provider_attachment_id,
            documentId: a.document_id,
          })),
        })),
        links,
        suggestions: await suggestLinks(db, org.id, row, msgs),
        draft,
        /*
         * There is no send path in this deployment. Saying so here, once, is what keeps a Send
         * button off the screen — the alternative is a button whose only effect is a toast.
         */
        sending: {
          available: false,
          reason:
            "Sending from ASAP is not connected yet. Copy this draft or open it in Gmail.",
        },
      }),
    );
  });

  /**
   * Save the reply being written.
   *
   * The server decides what an edit does to an approval: if the text no longer matches the digest
   * that was approved, the approval is cleared here, before the row is written. A browser that
   * forgot to clear it cannot leave an approved reply that nobody approved.
   */
  app.put("/email/threads/:id/draft", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, saveEmailDraftRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "email", "edit")) {
      throw new HttpError(403, "not_permitted", "You may not write replies in this brokerage.");
    }

    const thread = await db
      .from("email_threads")
      .select("id")
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (thread.error) return sendError(c, mapDatabaseError(thread.error));
    if (!thread.data) throw new HttpError(404, "not_found", "No conversation with that id");

    const existing = await db
      .from("email_drafts")
      .select("id, approved_body_sha256")
      .eq("organization_id", org.id)
      .eq("thread_id", id)
      .maybeSingle();
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));

    const digest = bodyDigest(input);
    const approvalSurvives =
      existing.data !== null &&
      (existing.data as { approved_body_sha256: string | null }).approved_body_sha256 === digest;

    const patch = {
      organization_id: org.id,
      thread_id: id,
      to_addresses: input.to,
      cc_addresses: input.cc,
      subject: input.subject,
      body_text: input.body,
      created_by: user.id,
      updated_at: new Date().toISOString(),
      ...(approvalSurvives
        ? {}
        : { approved_body_sha256: null, approved_by: null, approved_at: null }),
    };
    const saved = await db.from("email_drafts").upsert(patch, { onConflict: "thread_id" });
    if (saved.error) return sendError(c, mapDatabaseError(saved.error));

    if (!approvalSurvives && existing.data !== null) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "email.draft_approval_invalidated",
        objectType: "email_thread",
        objectId: id,
        result: "success",
        // The reply itself is the brokerage's correspondence and is never copied into audit.
        newState: { reason: "The reply was edited after it was approved." },
      });
    }

    const draft = await readDraft(db, org.id, id);
    return c.json({ draft });
  });

  /**
   * Approve the reply, exactly as it now reads.
   *
   * The digest of the approved body is stored with the approval, so an edit afterwards cannot
   * leave the approval standing — that is checked on save, and again by the database constraint.
   */
  app.post("/email/threads/:id/draft/approve", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "email", "approve")) {
      throw new HttpError(403, "not_permitted", "You may not approve replies in this brokerage.");
    }

    const existing = await db
      .from("email_drafts")
      .select("id, to_addresses, cc_addresses, subject, body_text")
      .eq("organization_id", org.id)
      .eq("thread_id", id)
      .maybeSingle();
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));
    if (!existing.data) throw new HttpError(404, "not_found", "There is no reply to approve.");
    const d = existing.data as DraftRow;

    const now = new Date().toISOString();
    const updated = await db
      .from("email_drafts")
      .update({
        approved_by: user.id,
        approved_at: now,
        approved_body_sha256: bodyDigest({
          to: d.to_addresses ?? [],
          cc: d.cc_addresses ?? [],
          subject: d.subject,
          body: d.body_text,
        }),
        updated_at: now,
      })
      .eq("organization_id", org.id)
      .eq("id", d.id)
      .select("id")
      .maybeSingle();
    if (updated.error) return sendError(c, mapDatabaseError(updated.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "email.draft_approved",
      objectType: "email_thread",
      objectId: id,
      result: "success",
      newState: { approvedAt: now },
    });

    return c.json({ draft: await readDraft(db, org.id, id) });
  });

  /**
   * Say what a conversation is about, or take back a link that was wrong.
   *
   * Every field is optional and a null removes that link. Nothing here is inferred: a suggestion
   * becomes a relationship only by arriving in this request, from a person.
   */
  app.put("/email/threads/:id/links", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, linkEmailThreadRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "email", "edit")) {
      throw new HttpError(403, "not_permitted", "You may not change what a conversation is about.");
    }

    const before = await db
      .from("email_threads")
      .select("id, subject, client_id, policy_id, work_item_id, mailbox_id, last_message_at, created_at")
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (before.error) return sendError(c, mapDatabaseError(before.error));
    if (!before.data) throw new HttpError(404, "not_found", "No conversation with that id");

    /*
     * A link is only accepted when the record it points at belongs to this brokerage and really
     * exists. Otherwise a thread could be linked to an id somebody typed, which would read on
     * screen as a confirmed relationship.
     */
    const patch: Record<string, string | null> = {};
    for (const [key, table, column] of [
      ["clientId", "clients", "client_id"],
      ["policyId", "policies", "policy_id"],
      ["workItemId", "work_items", "work_item_id"],
    ] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (value === null) {
        patch[column] = null;
        continue;
      }
      const found = await db
        .from(table)
        .select("id")
        .eq("organization_id", org.id)
        .eq("id", value)
        .maybeSingle();
      if (found.error) return sendError(c, mapDatabaseError(found.error));
      if (!found.data) {
        throw new HttpError(404, "not_found", "That record is not in this brokerage.");
      }
      patch[column] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, "invalid_request", "Say which link to set or remove.");
    }

    const updated = await db
      .from("email_threads")
      .update(patch)
      .eq("organization_id", org.id)
      .eq("id", id)
      .select("id, subject, client_id, policy_id, work_item_id, mailbox_id, last_message_at, created_at")
      .maybeSingle();
    if (updated.error) return sendError(c, mapDatabaseError(updated.error));
    if (!updated.data) throw new HttpError(404, "not_found", "No conversation with that id");

    const prior = before.data as ThreadRow;
    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "email.thread_linked",
      objectType: "email_thread",
      objectId: id,
      result: "success",
      previousState: {
        clientId: prior.client_id,
        policyId: prior.policy_id,
        workItemId: prior.work_item_id,
      },
      newState: patch,
    });

    return c.json({ links: await resolveLinks(db, org.id, updated.data as ThreadRow) });
  });

  /**
   * The reading state of one mailbox, from rows only.
   *
   * Every one of these words is something the server can prove. "Syncing" means a run row says
   * `running`; "Connected — last synced" means a run finished cleanly and wrote the time;
   * "Sync stopped" means a run failed and its reason is on the row. Nothing here is inferred from
   * how long ago something happened, because elapsed time cannot tell a quiet mailbox from a
   * broken one.
   */
  function syncStateOf(
    m: MailboxRow,
    run: SyncRunRow | null,
  ): {
    state: "never" | "syncing" | "idle" | "failed";
    runId: string | null;
    lastSyncedAt: string | null;
    error: string | null;
    canStart: boolean;
    cannotStartReason: string | null;
    messagesSaved: number;
    attachmentsSaved: number;
    hasCheckpoint: boolean;
    checkpointExpired: boolean;
  } {
    /* What the last pass managed, whatever it then did. A failure keeps what it saved. */
    const saved = {
      messagesSaved: run?.messages_saved ?? 0,
      attachmentsSaved: run?.attachments_saved ?? 0,
      hasCheckpoint: m.sync_cursor !== null,
      checkpointExpired: run?.checkpoint_expired ?? false,
    };
    if (m.status === "disconnected") {
      return {
        state: "never",
        runId: null,
        lastSyncedAt: null,
        error: null,
        canStart: false,
        ...saved,
        cannotStartReason: "This mailbox is disconnected.",
      };
    }
    if (m.status === "needs_reauthorisation") {
      return {
        state: "failed",
        runId: run?.id ?? null,
        lastSyncedAt: m.last_synced_at,
        error:
          m.status_reason ??
          "This mailbox needs authorising again before anything can be read.",
        canStart: false,
        ...saved,
        cannotStartReason: "Connect the mailbox again first.",
      };
    }
    if (run?.state === "running") {
      return {
        state: "syncing",
        runId: run.id,
        lastSyncedAt: m.last_synced_at,
        error: null,
        canStart: false,
        ...saved,
        cannotStartReason: "A pass is going now.",
      };
    }
    if (run?.state === "failed") {
      return {
        state: "failed",
        runId: run.id,
        // What was saved before it stopped is still saved, and the last good point stands.
        lastSyncedAt: m.last_synced_at,
        error: run.error,
        canStart: true,
        ...saved,
        cannotStartReason: null,
      };
    }
    if (m.last_synced_at !== null) {
      return {
        state: "idle",
        runId: run?.id ?? null,
        lastSyncedAt: m.last_synced_at,
        error: null,
        canStart: true,
        ...saved,
        cannotStartReason: null,
      };
    }
    return {
      state: "never",
      runId: run?.id ?? null,
      lastSyncedAt: null,
      error: null,
      canStart: true,
      ...saved,
      cannotStartReason: null,
    };
  }

  /** The most recent pass for each mailbox, which is what every state above is read from. */
  async function latestRuns(
    db: Db,
    organizationId: string,
    mailboxIds: string[],
  ): Promise<Map<string, SyncRunRow>> {
    const out = new Map<string, SyncRunRow>();
    if (mailboxIds.length === 0) return out;
    const { data } = await db
      .from("mailbox_sync_runs")
      .select("id, mailbox_id, state, error, started_at, finished_at, messages_saved, attachments_saved, cursor_after, checkpoint_expired")
      .eq("organization_id", organizationId)
      .in("mailbox_id", mailboxIds)
      .order("started_at", { ascending: false })
      .limit(200);
    for (const r of (data ?? []) as SyncRunRow[]) {
      if (!out.has(r.mailbox_id)) out.set(r.mailbox_id, r);
    }
    return out;
  }

  app.get("/mailboxes", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const { data, error } = await db
      .from("mailboxes")
      .select(MAILBOX_COLUMNS)
      .eq("organization_id", org.id)
      .order("created_at", { ascending: true });
    if (error) return sendError(c, mapDatabaseError(error));

    const rows = (data ?? []) as MailboxRow[];
    const runs = await latestRuns(db, org.id, rows.map((m) => m.id));

    const body: MailboxesResponse = mailboxesResponseSchema.parse({
      mailboxes: rows.map((m) => ({
        id: m.id,
        provider: m.provider,
        emailAddress: m.email_address,
        displayName: m.display_name,
        status: m.status,
        statusReason: m.status_reason,
        lastSyncedAt: m.last_synced_at,
        connectedAt: m.created_at,
        sync: syncStateOf(m, runs.get(m.id) ?? null),
      })),
      providers: (["gmail", "microsoft"] as const).map((id) => {
        const missing = missingFor(id, deps.oauth);
        return {
          id,
          label: MAILBOX_PROVIDER_LABELS[id],
          available: missing === null,
          unavailableReason: missing,
        };
      }),
    });
    return c.json(body);
  });

  /**
   * Begin connecting one. Answers with the provider's authorisation URL, or says plainly that this
   * deployment cannot connect that provider yet.
   */
  app.post("/mailboxes/connect", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, connectMailboxRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const missing = missingFor(input.provider, deps.oauth);
    if (missing) {
      return c.json(
        connectMailboxResponseSchema.parse({ outcome: "not_configured", reason: missing }),
        200,
      );
    }

    /*
     * The state parameter carries who asked and which brokerage, by being looked up rather than
     * trusted: 32 random bytes, stored as a digest, single-use and short-lived. The callback has
     * no session at all, so this row is the whole of its authentication.
     */
    const state = newOAuthState();
    const stored = await (deps.service?.() ?? db).from("mailbox_oauth_states").insert({
      organization_id: org.id,
      provider: input.provider,
      state_hash: state.hash,
      requested_by: user.id,
      expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    });
    if (stored.error) return sendError(c, mapDatabaseError(stored.error));
    const url =
      input.provider === "gmail"
        ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
        : new URL(
            `https://login.microsoftonline.com/${deps.oauth.microsoft.tenantId}/oauth2/v2.0/authorize`,
          );
    const clientId =
      input.provider === "gmail" ? deps.oauth.gmail.clientId! : deps.oauth.microsoft.clientId!;
    const redirectUri =
      input.provider === "gmail"
        ? deps.oauth.gmail.redirectUri!
        : deps.oauth.microsoft.redirectUri!;
    /*
     * Reading only.
     *
     * Permission to send is not asked for, because sending from ASAP is not built. Asking a
     * brokerage to grant standing authority to send mail as itself, before anything can send, is
     * asking for more than the product needs — and a consent screen listing a permission that
     * nothing uses teaches people not to read consent screens. When the send path lands it is a
     * separate authorisation, and the brokerage will see exactly what changed.
     */
    const scope =
      input.provider === "gmail"
        ? GMAIL_READ_SCOPES.join(" ")
        : "offline_access Mail.Read";
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state.value);
    if (input.provider === "gmail") {
      // Without these Google returns no refresh token on a repeat authorisation, and the
      // connection dies silently an hour later.
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
    }

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "mailbox.connect_started",
      objectType: "mailbox",
      result: "success",
      newState: { provider: input.provider },
    });

    return c.json(
      connectMailboxResponseSchema.parse({ outcome: "authorise", url: url.toString() }),
    );
  });

  /**
   * Read it again, now.
   *
   * This asks: it emits the event and returns. The reading itself is worker work, because it is
   * slow and because doing it inside a request would give a person a spinner whose only honest
   * caption is "this may take a while". A second press while a pass is going is refused by the
   * run row, not by a disabled button — the button is disabled too, but the row is what decides.
   */
  app.post("/mailboxes/:id/sync", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const box = await db
      .from("mailboxes")
      .select("id, status, status_reason")
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (box.error) return sendError(c, mapDatabaseError(box.error));
    if (!box.data) throw new HttpError(404, "not_found", "No mailbox with that id");
    const row = box.data as { status: string; status_reason: string | null };

    if (row.status === "disconnected") {
      throw new HttpError(409, "not_connected", "This mailbox is disconnected. Connect it again first.");
    }
    if (row.status === "needs_reauthorisation") {
      throw new HttpError(
        409,
        "needs_reauthorisation",
        row.status_reason ?? "This mailbox needs authorising again before anything can be read.",
      );
    }

    const running = await db
      .from("mailbox_sync_runs")
      .select("id")
      .eq("organization_id", org.id)
      .eq("mailbox_id", id)
      .eq("state", "running")
      .maybeSingle();
    if (running.error) return sendError(c, mapDatabaseError(running.error));
    if (running.data) {
      // Not an error: the thing they asked for is already happening, and this says which pass.
      return c.json({ requested: false, runId: (running.data as { id: string }).id });
    }

    await emitEvent(db, deps.logger, {
      organizationId: org.id,
      eventType: "mailbox.sync_requested",
      entityType: "mailbox",
      entityId: id,
      actor: "user",
      actorUserId: user.id,
      payload: { trigger: "person" },
    });

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "mailbox.sync_requested",
      objectType: "mailbox",
      objectId: id,
      result: "success",
      newState: { trigger: "person" },
    });

    return c.json({ requested: true, runId: null });
  });

  /**
   * Disconnect. The row stays — a mailbox that once fed this brokerage is part of its history —
   * and its tokens are cleared, so nothing can read or send with it again.
   */
  app.delete("/mailboxes/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");

    /*
     * Tell the provider first, while we still hold the token, then clear our own copy.
     *
     * The order matters and the failure mode is chosen: if revocation fails we still disconnect,
     * because a mailbox that cannot be told is still one ASAP will never read again — and a
     * person can revoke it in their own Google account, which is the authority that counts.
     * Doing it the other way round would leave a live grant nobody holds a handle to.
     *
     * Retrying a disconnect is safe: the second one finds no token, revokes nothing, and writes
     * the same row.
     */
    const before = await db
      .from("mailboxes")
      .select("id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at")
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (before.error) return sendError(c, mapDatabaseError(before.error));
    const held = before.data as {
      provider: MailboxProviderIdValue;
      access_token_encrypted: string | null;
      refresh_token_encrypted: string | null;
      token_expires_at: string | null;
    } | null;

    if (held && deps.encryptionKey && (held.access_token_encrypted || held.refresh_token_encrypted)) {
      const adapter = deps.providers?.[held.provider];
      if (adapter) {
        await adapter.revoke({
          accessToken: held.access_token_encrypted
            ? (decryptToken(held.access_token_encrypted, deps.encryptionKey) ?? "")
            : "",
          refreshToken: held.refresh_token_encrypted
            ? decryptToken(held.refresh_token_encrypted, deps.encryptionKey)
            : null,
          expiresAt: held.token_expires_at,
        });
      }
    }

    const { data, error } = await db
      .from("mailboxes")
      .update({
        status: "disconnected",
        status_reason: "Disconnected by a person in this brokerage.",
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        sync_cursor: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", org.id)
      .select(MAILBOX_COLUMNS)
      .maybeSingle();
    if (error) return sendError(c, mapDatabaseError(error));
    if (!data) return sendError(c, new HttpError(404, "not_found"));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "mailbox.disconnected",
      objectType: "mailbox",
      objectId: id,
      result: "success",
      newState: { status: "disconnected" },
    });
    return c.body(null, 204);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}

/** A thread row as selected above, with the client's name and its message count joined in. */
type ThreadRow = {
  id: string;
  subject: string;
  client_id: string | null;
  policy_id?: string | null;
  work_item_id: string | null;
  mailbox_id?: string | null;
  last_message_at: string | null;
  created_at?: string | null;
  clients?: { name: string } | { name: string }[] | null;
  email_messages?: { count: number }[] | null;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  provider_attachment_id: string | null;
  document_id: string | null;
};

type MailboxAddressRow = {
  provider: MailboxProviderIdValue;
  email_address: string;
  status: "connected" | "needs_reauthorisation" | "disconnected";
};

type DraftRow = {
  id: string;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  subject: string;
  body_text: string;
  approved_at?: string | null;
  approved_by?: string | null;
  updated_at?: string | null;
};

type MessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  from_address: string;
  to_addresses: string[] | null;
  subject: string;
  body_text: string | null;
  snippet: string | null;
  sent_at: string;
  has_attachments: boolean;
  cc_addresses?: string[] | null;
  provider_message_id: string;
};

function threadSummary(row: ThreadRow) {
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  return {
    id: row.id,
    subject: row.subject,
    clientId: row.client_id,
    clientName: client?.name ?? null,
    workItemId: row.work_item_id,
    lastMessageAt: row.last_message_at,
    messageCount: row.email_messages?.[0]?.count ?? 0,
  };
}

/**
 * The digest an approval is of.
 *
 * Recipients and subject are in it as well as the body, because approving a reply is approving
 * where it goes as much as what it says: adding a recipient to an approved draft is a material
 * change, and this is what makes the server treat it as one.
 */
type Db = SupabaseClient;

function bodyDigest(d: { to: string[]; cc: string[]; subject: string; body: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([d.to, d.cc, d.subject, d.body]))
    .digest("hex");
}

/** The reply being written, or null. Never carries who may send it: nothing may, yet. */
async function readDraft(db: Db, organizationId: string, threadId: string) {
  const { data } = await db
    .from("email_drafts")
    .select("id, to_addresses, cc_addresses, subject, body_text, approved_at, approved_by, updated_at")
    .eq("organization_id", organizationId)
    .eq("thread_id", threadId)
    .maybeSingle();
  if (!data) return null;
  const d = data as DraftRow;
  let approvedByName: string | null = null;
  if (d.approved_by) {
    const who = await db.from("users").select("display_name, full_name").eq("id", d.approved_by).maybeSingle();
    const u = who.data as { display_name: string | null; full_name: string | null } | null;
    approvedByName = u?.display_name ?? u?.full_name ?? null;
  }
  return {
    id: d.id,
    to: d.to_addresses ?? [],
    cc: d.cc_addresses ?? [],
    subject: d.subject,
    body: d.body_text,
    approvedAt: d.approved_at ?? null,
    approvedByName,
    updatedAt: d.updated_at ?? new Date(0).toISOString(),
  };
}

/** What the thread is linked to, with each record's own name read from its own table. */
async function resolveLinks(
  db: Db,
  organizationId: string,
  row: ThreadRow,
): Promise<EmailThreadLinks> {
  const client = row.client_id
    ? await db.from("clients").select("name").eq("organization_id", organizationId).eq("id", row.client_id).maybeSingle()
    : { data: null };
  const policy = row.policy_id
    ? await db.from("policies").select("policy_number").eq("organization_id", organizationId).eq("id", row.policy_id).maybeSingle()
    : { data: null };
  const work = row.work_item_id
    ? await db.from("work_items").select("title, kind").eq("organization_id", organizationId).eq("id", row.work_item_id).maybeSingle()
    : { data: null };
  const w = work.data as { title: string | null; kind: string | null } | null;
  return {
    clientId: row.client_id,
    clientName: (client.data as { name: string } | null)?.name ?? null,
    policyId: row.policy_id ?? null,
    policyNumber: (policy.data as { policy_number: string | null } | null)?.policy_number ?? null,
    workItemId: row.work_item_id,
    workItemTitle: w?.title ?? null,
    workItemKind: w?.kind ?? null,
  };
}

/** Everyone on the conversation, in the order they first appear. */
function participantsOf(msgs: MessageRow[]): string[] {
  const seen: string[] = [];
  for (const m of msgs) {
    for (const a of [m.from_address, ...(m.to_addresses ?? []), ...(m.cc_addresses ?? [])]) {
      if (a && !seen.includes(a)) seen.push(a);
    }
  }
  return seen;
}

/**
 * Whether something here is a person's to deal with.
 *
 * Two facts, both from rows: the last message came in and nobody has answered, or the conversation
 * is not linked to anything, so whatever it says is not attached to any client's file. Neither is
 * a judgement about the content — reading the email to decide that is a later capability, and it
 * would need evidence rather than a hunch.
 */
function unhandledOf(msgs: MessageRow[], links: EmailThreadLinks): string | null {
  const last = msgs[msgs.length - 1];
  if (last && last.direction === "inbound") return "The last message came in and has not been answered.";
  if (links.clientId === null) return "This conversation is not linked to a client yet.";
  return null;
}

/**
 * Links ASAP thinks are likely, each with the reason it thinks so.
 *
 * A suggestion is never written. `unambiguous` is true only where exactly one record matched on an
 * exact identifier — a contact's own email address, or a policy number written out in the text.
 * A similar name matches nothing here on purpose: two clients called Otieno are two clients.
 */
async function suggestLinks(db: Db, organizationId: string, row: ThreadRow, msgs: MessageRow[]) {
  const out: {
    target: "client" | "policy" | "work_item";
    id: string;
    label: string;
    because: string;
    unambiguous: boolean;
  }[] = [];

  if (row.client_id === null) {
    const addresses = participantsOf(msgs);
    if (addresses.length > 0) {
      const contacts = await db
        .from("client_contacts")
        .select("client_id, email, full_name")
        .eq("organization_id", organizationId)
        .in("email", addresses);
      const rows = (contacts.data ?? []) as { client_id: string; email: string; full_name: string }[];
      const byClient = new Map<string, { email: string; full_name: string }>();
      for (const r of rows) if (!byClient.has(r.client_id)) byClient.set(r.client_id, r);
      for (const [clientId, contact] of byClient) {
        const client = await db
          .from("clients")
          .select("name")
          .eq("organization_id", organizationId)
          .eq("id", clientId)
          .maybeSingle();
        const name = (client.data as { name: string } | null)?.name;
        if (!name) continue;
        out.push({
          target: "client",
          id: clientId,
          label: name,
          because: `${contact.email} is ${contact.full_name}'s address on this client's file.`,
          unambiguous: byClient.size === 1,
        });
      }
    }
  }

  if ((row.policy_id ?? null) === null) {
    /*
     * A policy number written out in the conversation. This is an exact identifier, which is why
     * it is allowed to suggest at all — the match is on the number as the brokerage records it,
     * not on anything that merely looks like one.
     */
    const text = [row.subject, ...msgs.map((m) => m.body_text ?? m.snippet ?? "")].join(" ");
    const policies = await db
      .from("policies")
      .select("id, policy_number")
      .eq("organization_id", organizationId)
      .limit(500);
    const hits = ((policies.data ?? []) as { id: string; policy_number: string | null }[]).filter(
      (p) => p.policy_number !== null && p.policy_number.length >= 4 && text.includes(p.policy_number),
    );
    for (const p of hits) {
      out.push({
        target: "policy",
        id: p.id,
        label: p.policy_number!,
        because: `Policy number ${p.policy_number} appears in this conversation.`,
        unambiguous: hits.length === 1,
      });
    }
  }

  return out;
}
