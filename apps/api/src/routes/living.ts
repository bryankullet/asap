import { livingSurfaceSchema } from "@asap/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, sendError } from "../errors.js";
import { loadRenewalLivingFacts } from "../living/facts.js";
import { composeRenewalSurface } from "../living/renewal.js";
import { validateSurface } from "../living/validate.js";
import type { Env } from "../placement/service.js";
import { loadDefinitions } from "../spaces/validate.js";

/**
 * `GET /living/:workItemId` — the Living renewal surface (D-156).
 *
 *   records the viewer may read → facts → deterministic composition → validation against the
 *   registry → permission filtering → the browser renders registered components
 *
 * Read-only. Composing a surface writes nothing and needs no model: an unavailable model only
 * switches off the parts of the interface that ask one. A surface our own composer built that our
 * own validator rejects is a defect, logged with its reasons; the browser receives a 422 and shows
 * a state, never a half-validated surface.
 */
export function livingRoutes(deps: { logger: Logger; aiAvailable: boolean }) {
  const app = new Hono();

  app.get("/living/:workItemId", async (c: Context) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const env: Env = {
      db,
      ctx,
      organizationId: org.id,
      userId: user.id,
      audit: (entry) => recordAudit(db, deps.logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }),
    };
    const workItemId = c.req.param("workItemId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(workItemId)) throw new HttpError(404, "not_found", "That work is not available.");

    const facts = await loadRenewalLivingFacts(env, workItemId);
    const surface = composeRenewalSurface(facts, { now: new Date(), aiAvailable: deps.aiAvailable });
    const definitions = await loadDefinitions(db, surface.blocks.map((b) => ({ component: b.component, version: b.version })));
    const result = validateSurface({ surface, definitions, permissions: ctx.permissions });
    if (!result.ok) {
      deps.logger.error({ workItemId, failures: result.failures }, "living surface rejected by the validator");
      throw new HttpError(422, "surface_invalid", "This workspace could not be composed");
    }
    return c.json(livingSurfaceSchema.parse(result.surface));
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
