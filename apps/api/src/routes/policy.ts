import { creationContextSchema, policySpaceResponseSchema, prepareActionResponseSchema } from "@asap/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError } from "../errors.js";
import type { Env } from "../placement/service.js";
import { preparePolicyAction, startRenewal } from "../policy/actions.js";
import { loadPolicySpace } from "../policy/space.js";
import { parseBody } from "./_parse.js";

/**
 * The Policy Space (4C-1). Thin on purpose: `policy/space.ts` assembles the reading and
 * `policy/actions.ts` holds the one backed workflow action; the screen, a confirmed prepared
 * action and Ask all go through them.
 */

async function envOf(c: Context, logger: Logger): Promise<Env> {
  const { db, user } = c.get("auth");
  const ctx = await resolveContext(db, user.id);
  const org = requireActiveOrganization(ctx);
  return {
    db, ctx, organizationId: org.id, userId: user.id,
    audit: (entry) => recordAudit(db, logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }),
  };
}

const uuid = z.string().uuid();

export function policyRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  /** One policy, every period, cover state with its evidence, terms four ways, work, timeline. */
  app.get("/policies/:id/space", async (c) => {
    const env = await envOf(c, deps.logger);
    const id = c.req.param("id");
    if (!uuid.safeParse(id).success) throw new HttpError(404, "not_found");
    const period = c.req.query("period");
    const body = await loadPolicySpace(env, id, { periodId: period && uuid.safeParse(period).success ? period : null });
    return c.json(policySpaceResponseSchema.parse(body));
  });

  /** Start (or reopen) this policy's renewal. Idempotent: a second start opens the same work. */
  app.post("/policies/:id/renewal", async (c) => {
    const env = await envOf(c, deps.logger);
    const r = await startRenewal(env, c.req.param("id"));
    return c.json(r, r.outcome === "blocked" ? 200 : r.outcome === "done" ? 201 : 200);
  });

  /** Ask's — or the screen's — proposal to start the renewal. Nothing runs until a person confirms. */
  app.post("/policies/:id/prepare", async (c) => {
    const env = await envOf(c, deps.logger);
    const input = await parseBody(c, z.object({ actionType: z.string().max(60) }));
    return c.json(prepareActionResponseSchema.parse(await preparePolicyAction(env, c.req.param("id"), input.actionType)));
  });

  /**
   * What a creation form may preselect. Read under the caller's session: a policy, period or client
   * in another brokerage is not found, so a URL parameter can never select one.
   */
  app.get("/creation-context", async (c) => {
    const env = await envOf(c, deps.logger);
    const policyId = c.req.query("policy");
    const periodId = c.req.query("period");
    const clientId = c.req.query("client");
    const { db, organizationId: org } = env;
    if (policyId) {
      if (!uuid.safeParse(policyId).success || !hasPermission(env.ctx, "policy", "view")) throw new HttpError(404, "not_found");
      const pol = (await db.from("policies").select("id, client_id, insurer_id, class_of_business, policy_number").eq("organization_id", org).eq("id", policyId).is("deleted_at", null).maybeSingle()).data as Record<string, string | null> | null;
      if (!pol) throw new HttpError(404, "not_found");
      const [cl, ins] = await Promise.all([
        db.from("clients").select("id, name").eq("organization_id", org).eq("id", pol["client_id"]!).is("deleted_at", null).maybeSingle(),
        db.from("insurers").select("name").eq("organization_id", org).eq("id", pol["insurer_id"]!).maybeSingle(),
      ]);
      if (!cl.data) throw new HttpError(404, "not_found");
      let period = null;
      if (periodId && uuid.safeParse(periodId).success) {
        const p = (await db.from("policy_periods").select("id, period_start, period_end").eq("organization_id", org).eq("policy_id", policyId).eq("id", periodId).maybeSingle()).data as Record<string, string> | null;
        period = p ? { id: p["id"]!, start: p["period_start"]!, end: p["period_end"]! } : null;
      }
      const insurerName = ((ins.data as { name: string } | null)?.name) ?? "the insurer";
      return c.json(creationContextSchema.parse({
        client: cl.data,
        policy: { id: pol["id"], label: `${pol["class_of_business"]} with ${insurerName}${pol["policy_number"] ? ` (${pol["policy_number"]})` : ""}`, insurerName, policyNumber: pol["policy_number"] },
        period,
      }));
    }
    if (clientId && uuid.safeParse(clientId).success) {
      const cl = (await db.from("clients").select("id, name").eq("organization_id", org).eq("id", clientId).is("deleted_at", null).maybeSingle()).data;
      if (!cl) throw new HttpError(404, "not_found");
      return c.json(creationContextSchema.parse({ client: cl, policy: null, period: null }));
    }
    throw new HttpError(404, "not_found");
  });

  return app;
}
