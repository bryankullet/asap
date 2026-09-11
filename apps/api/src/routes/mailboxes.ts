import {
  MAILBOX_COLUMNS,
  MAILBOX_PROVIDER_LABELS,
  connectMailboxRequestSchema,
  connectMailboxResponseSchema,
  mailboxesResponseSchema,
  emailThreadsResponseSchema,
  emailThreadResponseSchema,
  type MailboxProviderIdValue,
  type MailboxesResponse,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
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

type MailboxRow = {
  id: string;
  provider: MailboxProviderIdValue;
  email_address: string;
  display_name: string | null;
  status: "connected" | "needs_reauthorisation" | "disconnected";
  status_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export function mailboxRoutes(deps: { logger: Logger; oauth: MailboxOAuthConfig }) {
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

  /** One conversation, in order. The body is the brokerage's own correspondence — never logged. */
  app.get("/email/threads/:id", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const thread = await db
      .from("email_threads")
      .select(
        "id, subject, client_id, work_item_id, last_message_at, clients(name), email_messages(count)",
      )
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (thread.error) return sendError(c, mapDatabaseError(thread.error));
    if (!thread.data) throw new HttpError(404, "not_found", "No conversation with that id");

    const messages = await db
      .from("email_messages")
      .select(
        "id, direction, from_address, to_addresses, subject, body_text, snippet, sent_at, has_attachments",
      )
      .eq("organization_id", org.id)
      .eq("thread_id", id)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (messages.error) return sendError(c, mapDatabaseError(messages.error));

    return c.json(
      emailThreadResponseSchema.parse({
        thread: threadSummary(thread.data as ThreadRow),
        messages: ((messages.data ?? []) as MessageRow[]).map((m) => ({
          id: m.id,
          direction: m.direction,
          from: m.from_address,
          to: m.to_addresses ?? [],
          subject: m.subject,
          body: m.body_text,
          snippet: m.snippet,
          sentAt: m.sent_at,
          hasAttachments: m.has_attachments,
        })),
      }),
    );
  });

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

    const body: MailboxesResponse = mailboxesResponseSchema.parse({
      mailboxes: ((data ?? []) as MailboxRow[]).map((m) => ({
        id: m.id,
        provider: m.provider,
        emailAddress: m.email_address,
        displayName: m.display_name,
        status: m.status,
        statusReason: m.status_reason,
        lastSyncedAt: m.last_synced_at,
        connectedAt: m.created_at,
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
     * The state parameter carries who asked and which brokerage, signed by being random and
     * short-lived rather than guessable: the callback looks it up rather than trusting anything
     * the browser sends back. Storing it is the callback's half of this work.
     */
    const state = crypto.randomUUID();
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
    const scope =
      input.provider === "gmail"
        ? "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"
        : "offline_access Mail.Read Mail.Send";
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
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
   * Disconnect. The row stays — a mailbox that once fed this brokerage is part of its history —
   * and its tokens are cleared, so nothing can read or send with it again.
   */
  app.delete("/mailboxes/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");

    const { data, error } = await db
      .from("mailboxes")
      .update({
        status: "disconnected",
        status_reason: "Disconnected by a person in this brokerage.",
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
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
  work_item_id: string | null;
  last_message_at: string | null;
  clients: { name: string } | { name: string }[] | null;
  email_messages: { count: number }[] | null;
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
