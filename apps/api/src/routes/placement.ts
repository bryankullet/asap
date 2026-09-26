import {
  confirmPreparedActionResponseSchema,
  placementActionResponseSchema,
  placementActionSchema,
  placementResponseSchema,
  prepareActionRequestSchema,
  prepareActionResponseSchema,
  recordInstructionRequestSchema,
  recordInstructionResponseSchema,
} from "@asap/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { confirmPreparedAction, discardPreparedAction, prepareAction } from "../placement/prepared.js";
import { executePlacementAction, executeRecordInstruction, load, type Env } from "../placement/service.js";
import { parseBody } from "./_parse.js";

/**
 * Placement routes (4B-4, 4B-4A). Thin on purpose: every rule lives in `placement/service.ts`,
 * which the screen's actions, confirmed prepared actions and Ask all share, so none of them can
 * do what the others may not.
 */

export { coverOf, placementTitle } from "../placement/service.js";

async function envOf(c: Context, logger: Logger): Promise<Env> {
  const { db, user } = c.get("auth");
  const ctx = await resolveContext(db, user.id);
  const org = requireActiveOrganization(ctx);
  return {
    db,
    ctx,
    organizationId: org.id,
    userId: user.id,
    audit: (entry) => recordAudit(db, logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }),
  };
}

export function placementRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.post("/opportunities/:id/instruction", async (c) => {
    const env = await envOf(c, deps.logger);
    const input = await parseBody(c, recordInstructionRequestSchema);
    const result = await executeRecordInstruction(env, c.req.param("id"), input);
    return c.json(recordInstructionResponseSchema.parse(result));
  });

  app.get("/placements/:id", async (c) => {
    const env = await envOf(c, deps.logger);
    return c.json(placementResponseSchema.parse(await load(env.db, env.ctx, env.organizationId, c.req.param("id"))));
  });

  app.post("/placements/:id/actions", async (c) => {
    const env = await envOf(c, deps.logger);
    const id = c.req.param("id");
    const input = await parseBody(c, placementActionSchema);
    const result = await executePlacementAction(env, id, input);
    const placement = result.outcome === "blocked" ? null : await load(env.db, env.ctx, env.organizationId, id);
    return c.json(placementActionResponseSchema.parse({ ...result, placement }));
  });

  /* ---- Prepared actions: prepared here or by Ask, run only when a person confirms ------------ */

  app.post("/placements/:id/prepare", async (c) => {
    const env = await envOf(c, deps.logger);
    const input = await parseBody(c, prepareActionRequestSchema);
    const result = await prepareAction(env, { ...input, placementId: c.req.param("id") });
    return c.json(prepareActionResponseSchema.parse(result));
  });

  app.post("/opportunities/:id/prepare", async (c) => {
    const env = await envOf(c, deps.logger);
    const input = await parseBody(c, prepareActionRequestSchema);
    const result = await prepareAction(env, { ...input, actionType: "record_instruction", opportunityId: c.req.param("id") });
    return c.json(prepareActionResponseSchema.parse(result));
  });

  app.post("/prepared-actions/:id/confirm", async (c) => {
    const env = await envOf(c, deps.logger);
    return c.json(confirmPreparedActionResponseSchema.parse(await confirmPreparedAction(env, c.req.param("id"))));
  });

  app.post("/prepared-actions/:id/discard", async (c) => {
    const env = await envOf(c, deps.logger);
    return c.json(confirmPreparedActionResponseSchema.parse(await discardPreparedAction(env, c.req.param("id"))));
  });

  return app;
}
