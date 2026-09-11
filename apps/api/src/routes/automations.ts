import {
  AUTOMATION_COLUMNS,
  AUTOMATION_RUN_COLUMNS,
  AutomationTrigger,
  ActionVerb,
  EXTERNALLY_SENDING_VERBS,
  automationConditionSchema,
  automationRunSchema,
  automationSchema,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/**
 * Automations: the standing instructions, their history, and the decisions on what they prepared.
 *
 * The surface is deliberately narrow. There is no endpoint that makes an automation act, and no
 * endpoint that approves one in bulk. What it prepared is applied through the engine, one action
 * at a time, by a person — with the record's own guards, as if they had done it themselves.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  triggerEvent: AutomationTrigger,
  conditions: z.array(automationConditionSchema).max(8).default([]),
  skill: z.string().trim().min(1).max(80),
  preparedVerb: ActionVerb,
  approval: z.enum(["always", "never"]).default("always"),
  enabled: z.boolean().default(false),
});

export function automationRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/automations", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("automations")
      .select(AUTOMATION_COLUMNS)
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(100);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json({ automations: automationSchema.array().parse(data ?? []) });
  });

  /** The history. Every firing, including the ones that did nothing — that is the point of it. */
  app.get("/automations/:id/runs", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("automation_runs")
      .select(AUTOMATION_RUN_COLUMNS)
      .eq("organization_id", org.id)
      .eq("automation_id", c.req.param("id"))
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json({ runs: automationRunSchema.array().parse(data ?? []) });
  });

  app.post("/automations", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "That automation is not complete.");
    const body = parsed.data;

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "automation", "create")) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "automation.create",
        objectType: "automation",
        result: "denied",
        failureReason: "missing automation:create",
      });
      throw new HttpError(403, "forbidden", "Your role cannot create automations.");
    }

    // Whether this reaches outside the brokerage is read from the verb, never taken from the
    // request. A browser that could set it false would be a way around §45 rule 13.
    const sendsExternally = EXTERNALLY_SENDING_VERBS.includes(body.preparedVerb);
    const approval = sendsExternally ? "always" : body.approval;

    const { data, error } = await db
      .from("automations")
      .insert({
        organization_id: org.id,
        name: body.name,
        description: body.description,
        trigger_event: body.triggerEvent,
        conditions: body.conditions,
        skill: body.skill,
        prepared_verb: body.preparedVerb,
        approval,
        sends_externally: sendsExternally,
        enabled: body.enabled,
        created_by: user.id,
      })
      .select(AUTOMATION_COLUMNS)
      .single();
    if (error) return sendError(c, mapDatabaseError(error));
    const automation = automationSchema.parse(data);

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "automation.created",
      objectType: "automation",
      objectId: automation.id,
      result: "success",
      newState: {
        name: automation.name,
        trigger: automation.trigger_event,
        verb: automation.prepared_verb,
        approval: automation.approval,
        enabled: automation.enabled,
      },
    });
    return c.json({ automation }, 201);
  });

  /**
   * Switching one on or off. Audited either way: an automation that stopped running is something
   * a brokerage needs to be able to account for afterwards.
   */
  app.post("/automations/:id/enabled", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "enabled is required");

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "automation", "edit")) {
      throw new HttpError(403, "forbidden", "Your role cannot change automations.");
    }

    const { data, error } = await db
      .from("automations")
      .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
      .eq("organization_id", org.id)
      .eq("id", c.req.param("id"))
      .select(AUTOMATION_COLUMNS)
      .single();
    if (error) return sendError(c, mapDatabaseError(error));
    const automation = automationSchema.parse(data);

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: parsed.data.enabled ? "automation.enabled" : "automation.disabled",
      objectType: "automation",
      objectId: automation.id,
      result: "success",
      newState: { enabled: automation.enabled },
    });
    return c.json({ automation });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
