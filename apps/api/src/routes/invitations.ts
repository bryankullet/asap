import {
  acceptInvitationResponseSchema,
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  invitationPreviewSchema,
  invitationTokenSchema,
  invitationsResponseSchema,
  type InvitationSummary,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import type { Mailer } from "../mail/index.js";
import type { SupabaseFactory } from "../supabase.js";
import { generateInvitationToken, hashInvitationToken } from "../tokens.js";
import { parseBody } from "./_parse.js";

export type InvitationDeps = {
  logger: Logger;
  mailer: Mailer;
  supabase: SupabaseFactory;
  webBaseUrl: string;
  invitationTtlHours: number;
  /** Local only: return the accept URL in the response so a developer can follow it. */
  exposeAcceptUrl: boolean;
};

type InvitationRow = {
  id: string;
  email: string;
  status: InvitationSummary["status"];
  expires_at: string;
  created_at: string;
  role: InvitationSummary["role"] | null;
  invited_by: InvitationSummary["invited_by"];
};

function acceptUrl(webBaseUrl: string, token: string): string {
  return new URL(`/invite/${token}`, webBaseUrl).toString();
}

/** Routes that need a signed-in user (mounted behind requireUser). */
export function invitationRoutes(deps: InvitationDeps) {
  const app = new Hono();

  /** Pending invitations of the active brokerage. Requires user:view. */
  app.get("/organizations/current/invitations", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "user", "view"))
      return sendError(c, new HttpError(403, "permission_denied"));

    const { data, error } = await db
      .from("invitations")
      .select(
        `id, email, status, expires_at, created_at,
         role:roles ( id, key, name ),
         invited_by:users!invitations_invited_by_fkey ( id, email, full_name )`,
      )
      .eq("organization_id", org.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) return sendError(c, mapDatabaseError(error));

    const invitations: InvitationSummary[] = ((data ?? []) as unknown as InvitationRow[])
      .filter((i) => i.role)
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as InvitationSummary["role"],
        // The table says pending; the clock may say otherwise.
        status: new Date(i.expires_at) < new Date() ? "expired" : i.status,
        invited_by: i.invited_by,
        expires_at: i.expires_at,
        created_at: i.created_at,
      }));
    return c.json(invitationsResponseSchema.parse({ invitations }));
  });

  /** §7 Step 2 — invite by email with a role. Token generated here; only its hash is stored. */
  app.post("/organizations/current/invitations", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const input = await parseBody(c, createInvitationRequestSchema);

    const token = generateInvitationToken();
    const { data: invitationId, error } = await db.rpc("create_invitation", {
      p_organization_id: org.id,
      p_email: input.email,
      p_role_id: input.role_id,
      p_token_hash: hashInvitationToken(token),
      p_ttl_hours: deps.invitationTtlHours,
    });
    if (error) {
      const mapped = mapDatabaseError(error);
      if (mapped.status === 403) {
        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "invitation.created",
          objectType: "invitation",
          newState: { email: input.email, role_id: input.role_id },
          result: "denied",
          failureReason: "missing permission user:create",
        });
      }
      return sendError(c, mapped);
    }

    const roleName = await roleNameFor(db, input.role_id);
    const expiresAt = new Date(Date.now() + deps.invitationTtlHours * 3_600_000);
    const url = acceptUrl(deps.webBaseUrl, token);
    try {
      await deps.mailer.sendInvitation({
        to: input.email,
        organizationName: org.name,
        roleName,
        inviterName: ctx.profile.full_name ?? ctx.profile.email,
        acceptUrl: url,
        expiresAt,
      });
    } catch (err) {
      // The invitation row exists; the admin can re-invite (which revokes and replaces it).
      deps.logger.error({ err, invitation_id: invitationId }, "invitation email failed");
      return sendError(c, new HttpError(502, "invitation_email_failed"));
    }

    return c.json(
      createInvitationResponseSchema.parse({
        invitation_id: invitationId,
        email: input.email,
        expires_at: expiresAt.toISOString(),
        ...(deps.exposeAcceptUrl ? { accept_url: url } : {}),
      }),
      201,
    );
  });

  app.post("/organizations/current/invitations/:invitationId/revoke", async (c) => {
    const { db } = c.get("auth");
    const { error } = await db.rpc("revoke_invitation", {
      p_invitation_id: c.req.param("invitationId"),
    });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.body(null, 204);
  });

  /** Accept. Idempotent in the database; the email on the session must match the invitation. */
  app.post("/invitations/:token/accept", async (c) => {
    const { db } = c.get("auth");
    const token = invitationTokenSchema.safeParse(c.req.param("token"));
    if (!token.success) return sendError(c, new HttpError(404, "not_found"));

    const { data, error } = await db.rpc("accept_invitation", {
      p_token_hash: hashInvitationToken(token.data),
    });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(acceptInvitationResponseSchema.parse({ organization_id: data }));
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return sendError(c, err, (err as HttpError & { details?: unknown }).details);
    }
    throw err;
  });
  return app;
}

/** Public preview: what the accept page shows before sign-in. The token is the credential. */
export function invitationPublicRoutes(deps: Pick<InvitationDeps, "supabase">) {
  const app = new Hono();
  app.get("/invitations/:token", async (c) => {
    const token = invitationTokenSchema.safeParse(c.req.param("token"));
    if (!token.success) return sendError(c, new HttpError(404, "not_found"));
    const { data, error } = await deps.supabase
      .anon()
      .rpc("invitation_preview", { p_token_hash: hashInvitationToken(token.data) });
    if (error) return sendError(c, mapDatabaseError(error));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return sendError(c, new HttpError(404, "not_found"));
    return c.json(invitationPreviewSchema.parse(row));
  });
  return app;
}

async function roleNameFor(
  db: ReturnType<SupabaseFactory["forUser"]>,
  roleId: string,
): Promise<string> {
  const { data } = await db.from("roles").select("name").eq("id", roleId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "a team member";
}
