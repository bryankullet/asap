import {
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  membersResponseSchema,
  rolesResponseSchema,
  updateMemberRequestSchema,
  type Member,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

type MemberRow = {
  id: string;
  is_owner: boolean;
  status: Member["status"];
  joined_at: string;
  user: Member["user"] | null;
  role: Member["role"] | null;
};

export function organizationRoutes(logger: Logger) {
  const app = new Hono();

  /** §7 Step 1 — create the brokerage. The caller becomes owner and administrator. */
  app.post("/organizations", async (c) => {
    const { db } = c.get("auth");
    const input = await parseBody(c, createOrganizationRequestSchema);
    const { data, error } = await db.rpc("create_organization", {
      p_name: input.name,
      p_legal_name: input.legal_name ?? null,
      p_country: input.country,
      p_currency: input.currency,
      p_timezone: input.timezone,
      p_accepted_terms: input.accepted_terms,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(createOrganizationResponseSchema.parse({ organization_id: data }), 201);
  });

  /** Roles of the active brokerage — what an invitation or member can be assigned. */
  app.get("/organizations/current/roles", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("roles")
      .select("id, key, name, description, is_system")
      .eq("organization_id", org.id)
      .order("name");
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(rolesResponseSchema.parse({ roles: data }));
  });

  /** Member list of the active brokerage. Requires user:view. */
  app.get("/organizations/current/members", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "user", "view")) {
      await recordAudit(db, logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "members.listed",
        objectType: "user",
        result: "denied",
        failureReason: "missing permission user:view",
      });
      return sendError(c, new HttpError(403, "permission_denied"));
    }
    const { data, error } = await db
      .from("organization_memberships")
      .select(
        `id, is_owner, status, joined_at,
         user:users ( id, email, full_name, display_name, last_seen_at ),
         role:roles ( id, key, name, description, is_system )`,
      )
      .eq("organization_id", org.id)
      .neq("status", "removed")
      .order("joined_at", { ascending: true });
    if (error) return sendError(c, mapDatabaseError(error));

    const members: Member[] = ((data ?? []) as unknown as MemberRow[])
      .filter((m) => m.user && m.role)
      .map((m) => ({
        membership_id: m.id,
        user: m.user as Member["user"],
        role: m.role as Member["role"],
        is_owner: m.is_owner,
        status: m.status,
        joined_at: m.joined_at,
      }));
    return c.json(membersResponseSchema.parse({ members }));
  });

  /** Change a member's role or status. The database function enforces user:edit and owner rules. */
  app.patch("/organizations/current/members/:membershipId", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const membershipId = c.req.param("membershipId");
    const input = await parseBody(c, updateMemberRequestSchema);

    const { error } = await db.rpc("update_membership", {
      p_membership_id: membershipId,
      p_role_id: input.role_id ?? null,
      p_status: input.status ?? null,
    });
    if (error) {
      const mapped = mapDatabaseError(error);
      if (mapped.status === 403) {
        await recordAudit(db, logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "membership.updated",
          objectType: "membership",
          objectId: membershipId,
          newState: { ...input },
          result: "denied",
          failureReason: mapped.code,
        });
      }
      return sendError(c, mapped);
    }
    return c.body(null, 204);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return sendError(c, err, (err as HttpError & { details?: unknown }).details);
    }
    throw err;
  });
  return app;
}
