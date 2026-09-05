import {
  meResponseSchema,
  setActiveOrganizationRequestSchema,
  type MeResponse,
} from "@asap/schema";
import { Hono } from "hono";
import { resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

export function meRoutes() {
  const app = new Hono();

  /** Who am I, where do I belong, which brokerage is active. Everything resolved server-side. */
  app.get("/me", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const body: MeResponse = meResponseSchema.parse({
      user: {
        id: ctx.profile.id,
        email: ctx.profile.email,
        full_name: ctx.profile.full_name,
        display_name: ctx.profile.display_name,
      },
      memberships: ctx.memberships,
      active_organization: ctx.activeOrganization,
      permissions: [...ctx.permissions].sort(),
    });
    return c.json(body);
  });

  /** Switch brokerage. The database function refuses any organization the caller is not an active member of. */
  app.post("/me/active-organization", async (c) => {
    const { db } = c.get("auth");
    const input = await parseBody(c, setActiveOrganizationRequestSchema);
    const { error } = await db.rpc("set_active_organization", {
      p_organization_id: input.organization_id,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.body(null, 204);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
