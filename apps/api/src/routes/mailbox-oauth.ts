import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { emitEvent } from "../events/emit.js";
import { encryptToken, hashOAuthState, sameDigest } from "../mailbox/crypto.js";
import type { MailboxProvider } from "../mailbox/types.js";
import { HttpError, sendError } from "../errors.js";

/**
 * The end of the authorisation round trip.
 *
 * This route has **no session**, and cannot have one: the person arrives here by a redirect from
 * Google, in a plain browser navigation, with no bearer token. So the `state` parameter is the
 * authentication — server-generated, 32 random bytes, stored as a digest, single-use and
 * short-lived. It says which brokerage asked and who asked, and it is consumed the moment it is
 * accepted, so a replayed callback finds it spent.
 *
 * What this route does **not** do is read the mailbox. Exchanging a code is quick; reading a
 * mailbox is not, and a callback that tried would hold the person's browser open for as long as
 * their mailbox is large, then time out with a connection half made. It records the connection,
 * emits `mailbox.sync_requested`, and redirects — the reading happens where slow work belongs.
 *
 * Nothing it handles reaches the browser: not the code, not the tokens, and not the state, which
 * is consumed before the redirect so the URL the person lands on carries none of it.
 */
export function mailboxOAuthRoutes(deps: {
  logger: Logger;
  service: () => SupabaseClient;
  providers: Partial<Record<"gmail" | "microsoft", MailboxProvider>>;
  redirectUris: Partial<Record<"gmail" | "microsoft", string>>;
  encryptionKey: string;
  webBaseUrl: string;
}) {
  const app = new Hono();

  app.get("/mailboxes/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "gmail" && provider !== "microsoft") {
      throw new HttpError(404, "not_found", "No such provider");
    }

    const back = (outcome: string) =>
      c.redirect(`${deps.webBaseUrl}/connections?mailbox=${encodeURIComponent(outcome)}`, 302);

    /*
     * Google reports a refusal by redirecting here with `error`. That is a person deciding not to
     * grant access, which is not a fault: it goes back to the same screen saying so.
     */
    if (c.req.query("error")) return back("refused");

    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!state || !code) return back("incomplete");

    const db = deps.service();
    const now = new Date().toISOString();

    const stateQ = await db
      .from("mailbox_oauth_states")
      .select("id, organization_id, provider, state_hash, requested_by, consumed_at, expires_at")
      .eq("state_hash", hashOAuthState(state))
      .maybeSingle();
    const row = stateQ.data as
      | {
          id: string;
          organization_id: string;
          provider: "gmail" | "microsoft";
          state_hash: string;
          requested_by: string;
          consumed_at: string | null;
          expires_at: string;
        }
      | null;

    // Never issued, already used, expired, or for a different provider: all the same answer.
    if (
      row === null ||
      !sameDigest(row.state_hash, hashOAuthState(state)) ||
      (row.consumed_at ?? null) !== null ||
      row.expires_at <= now ||
      row.provider !== provider
    ) {
      deps.logger.warn({ provider }, "a mailbox callback presented a state we would not accept");
      return back("expired");
    }

    /*
     * Consume it first, conditionally. Two callbacks arriving together — a double-submitted
     * redirect, a browser prefetch — must not both proceed, and the condition is what decides
     * which one does.
     */
    const consumed = await db
      .from("mailbox_oauth_states")
      .update({ consumed_at: now })
      .eq("id", row.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (consumed.error || !consumed.data) return back("expired");

    const adapter = deps.providers[provider];
    const redirectUri = deps.redirectUris[provider];
    if (!adapter || !redirectUri) return back("not_configured");

    const exchanged = await adapter.exchangeCode({ code, redirectUri });
    if (exchanged.outcome === "failed") {
      await recordAudit(db, deps.logger, c, {
        organizationId: row.organization_id,
        actorUserId: row.requested_by,
        action: "mailbox.connect_failed",
        objectType: "mailbox",
        result: "failure",
        // The provider's own body is never repeated here: it can carry the code and the client id.
        newState: { provider, reason: exchanged.reason },
      });
      return back("failed");
    }

    /*
     * One mailbox per address per brokerage. Connecting the same address again re-authorises the
     * row that exists rather than making a second one — which is what stops a double-clicked
     * Connect, or a person reconnecting after an expiry, from producing two mailboxes reading the
     * same inbox twice.
     */
    const existing = await db
      .from("mailboxes")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("email_address", exchanged.emailAddress)
      .maybeSingle();

    const tokens = {
      access_token_encrypted: encryptToken(exchanged.credentials.accessToken, deps.encryptionKey),
      refresh_token_encrypted:
        exchanged.credentials.refreshToken === null
          ? null
          : encryptToken(exchanged.credentials.refreshToken, deps.encryptionKey),
      token_expires_at: exchanged.credentials.expiresAt,
      status: "connected",
      status_reason: null,
      updated_at: now,
    };

    let mailboxId: string;
    if (existing.data) {
      mailboxId = (existing.data as { id: string }).id;
      const updated = await db.from("mailboxes").update(tokens).eq("id", mailboxId).select("id").maybeSingle();
      if (updated.error) return back("failed");
    } else {
      const inserted = await db
        .from("mailboxes")
        .insert({
          organization_id: row.organization_id,
          provider,
          email_address: exchanged.emailAddress,
          display_name: exchanged.displayName,
          connected_by: row.requested_by,
          ...tokens,
        })
        .select("id")
        .maybeSingle();
      if (inserted.error || !inserted.data) return back("failed");
      mailboxId = (inserted.data as { id: string }).id;
    }

    await recordAudit(db, deps.logger, c, {
      organizationId: row.organization_id,
      actorUserId: row.requested_by,
      action: "mailbox.connected",
      objectType: "mailbox",
      objectId: mailboxId,
      result: "success",
      // The address, never a token. There is nowhere in this payload one could go.
      newState: { provider, emailAddress: exchanged.emailAddress },
    });

    /* The first read, asked for rather than done here. */
    await emitEvent(db, deps.logger, {
      organizationId: row.organization_id,
      eventType: "mailbox.sync_requested",
      entityType: "mailbox",
      entityId: mailboxId,
      actor: "user",
      actorUserId: row.requested_by,
      payload: { trigger: "first_connection" },
    });

    return back("connected");
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
