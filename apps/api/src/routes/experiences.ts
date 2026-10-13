import {
  askExperienceRequestSchema,
  experienceEventRequestSchema,
  experienceListResponseSchema,
  experienceResponseSchema,
  saveUiStateRequestSchema,
  saveUiStateResponseSchema,
  startExperienceRequestSchema,
  type AiProvider,
} from "@asap/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { askExperience, archiveExperience, experienceEvent, getExperience, listExperiences, saveUiState, startExperience } from "../experience/service.js";
import type { Env } from "../placement/service.js";
import { parseBody } from "./_parse.js";

/**
 * The progressive experience API (D-172). The organization and the person come from the session,
 * never the request; every record an experience names is re-read under that session; every
 * composition is validated before it leaves. Writes here touch only experience_sessions (interface
 * state, RLS-scoped). Business changes go through the endpoints that own them.
 */
export function experienceRoutes(deps: { logger: Logger; provider: AiProvider | null }) {
  const app = new Hono();
  const envOf = async (c: Context): Promise<Env> => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return { db, ctx, organizationId: org.id, userId: user.id, audit: (entry) => recordAudit(db, deps.logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }) };
  };
  const d = { logger: deps.logger, provider: deps.provider };

  app.get("/experiences", async (c) => c.json(experienceListResponseSchema.parse({ items: await listExperiences(await envOf(c)) })));

  app.post("/experiences", async (c) => {
    const input = await parseBody(c, startExperienceRequestSchema);
    return c.json(experienceResponseSchema.parse(await startExperience(await envOf(c), d, input.text, input.subject)), 201);
  });

  app.get("/experiences/:id", async (c) => c.json(experienceResponseSchema.parse(await getExperience(await envOf(c), d, c.req.param("id")))));

  app.post("/experiences/:id/ask", async (c) => {
    const input = await parseBody(c, askExperienceRequestSchema);
    return c.json(experienceResponseSchema.parse(await askExperience(await envOf(c), d, c.req.param("id"), input.text)));
  });

  app.post("/experiences/:id/events", async (c) => {
    const input = await parseBody(c, experienceEventRequestSchema);
    return c.json(experienceResponseSchema.parse(await experienceEvent(await envOf(c), d, c.req.param("id"), input)));
  });

  app.put("/experiences/:id/state", async (c) => {
    const input = await parseBody(c, saveUiStateRequestSchema);
    const r = await saveUiState(await envOf(c), c.req.param("id"), input.baseVersion, input.ui);
    return c.json(saveUiStateResponseSchema.parse(r), r.conflict ? 409 : 200);
  });

  app.post("/experiences/:id/archive", async (c) => {
    await archiveExperience(await envOf(c), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
