import {
  AUTOMATION_COLUMNS,
  AUTOMATION_RUN_COLUMNS,
  createAutomationRequestSchema,
  EXTERNALLY_SENDING_VERBS,
  automationRunSchema,
  automationSchema,
  automationProblems,
  automationTestResponseSchema,
  AUTOMATION_REGISTRY,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { evaluateConditions } from "../automations/engine.js";

/**
 * Automations: the standing instructions, their history, and the decisions on what they prepared.
 *
 * The surface is deliberately narrow. There is no endpoint that makes an automation act, and no
 * endpoint that approves one in bulk. What it prepared is applied through the engine, one action
 * at a time, by a person — with the record's own guards, as if they had done it themselves.
 */

/** One definition, shared with the browser's builder (`@asap/schema`), so the two cannot drift. */
const createSchema = createAutomationRequestSchema;

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
    // Only what the registry can execute is saved as an automation (D-125). Anything else is a
    // proposal, and saying so beats a standing instruction that silently never runs.
    const problems = automationProblems({ ...body, approval });
    if (problems.length) {
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "automation.create", objectType: "automation", result: "denied", failureReason: "not_executable" });
      return c.json({ error: { code: "not_executable", message: "This automation cannot run as written: " + problems.join("; ") + ". Nothing was saved.", problems } }, 422);
    }


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
  /** What an automation can do today: the registry the builder and Ask validate against. */
  app.get("/automations/registry", (c) => c.json(AUTOMATION_REGISTRY));

  /**
   * Test mode. The automation's conditions are checked against open work of this brokerage and
   * the answer says which items it would act on and why the rest would not. Nothing is prepared,
   * no run is written, no Work changes. The test itself is audited, and the latest one is read
   * back as the automation's last test result.
   */
  app.post("/automations/:id/test", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const a = await db.from("automations").select(AUTOMATION_COLUMNS).eq("organization_id", org.id).eq("id", c.req.param("id")).is("deleted_at", null).maybeSingle();
    if (a.error) return sendError(c, mapDatabaseError(a.error));
    if (!a.data) throw new HttpError(404, "not_found", "No automation with that id");
    const automation = automationSchema.parse(a.data);
    const items = await db.from("work_items").select(WORK_ITEM_COLUMNS).eq("organization_id", org.id).is("deleted_at", null).neq("task_status", "done").order("updated_at", { ascending: false }).limit(25);
    if (items.error) return sendError(c, mapDatabaseError(items.error));
    const now = Date.now();
    const wouldFire: { workItemId: string; title: string }[] = [];
    const wouldNotFire: { workItemId: string; title: string; failed: ReturnType<typeof evaluateConditions>["results"] }[] = [];
    for (const row of items.data ?? []) {
      const item = WorkItemRow.parse(row);
      const r = evaluateConditions(automation.conditions, item, {}, now);
      if (r.held) wouldFire.push({ workItemId: item.id, title: item.title });
      else wouldNotFire.push({ workItemId: item.id, title: item.title, failed: r.results.filter((x) => !x.held) });
    }
    const body = automationTestResponseSchema.parse({
      testedAt: new Date(now).toISOString(),
      checked: (items.data ?? []).length,
      wouldFire,
      wouldNotFire,
      problems: automationProblems({ triggerEvent: automation.trigger_event, conditions: automation.conditions, preparedVerb: automation.prepared_verb, approval: automation.approval }),
    });
    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "automation.tested",
      objectType: "automation",
      objectId: automation.id,
      result: "success",
      newState: { checked: body.checked, wouldFire: body.wouldFire.length, problems: body.problems },
    });
    return c.json(body);
  });

  /** The latest test of an automation, from the audit history — or null if it was never tested. */
  app.get("/automations/:id/last-test", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data } = await db.from("audit_log").select("new_state, occurred_at").eq("organization_id", org.id).eq("object_id", c.req.param("id")).eq("action", "automation.tested").order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    const row = data as { new_state: { checked?: number; wouldFire?: number; problems?: string[] } | null; occurred_at: string } | null;
    return c.json({ lastTest: row ? { testedAt: row.occurred_at, checked: row.new_state?.checked ?? 0, wouldFire: row.new_state?.wouldFire ?? 0, problems: row.new_state?.problems ?? [] } : null });
  });

  app.post("/automations/:id/enabled", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "enabled is required");

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "automation", "edit")) {
      throw new HttpError(403, "forbidden", "Your role cannot change automations.");
    }

    // Switching on something that cannot run would read as a working automation; refuse it.
    if (parsed.data.enabled) {
      const cur = await db.from("automations").select(AUTOMATION_COLUMNS).eq("organization_id", org.id).eq("id", c.req.param("id")).maybeSingle();
      if (cur.data) {
        const a = automationSchema.parse(cur.data);
        const problems = automationProblems({ triggerEvent: a.trigger_event, conditions: a.conditions, preparedVerb: a.prepared_verb, approval: a.approval });
        if (problems.length) return c.json({ error: { code: "not_executable", message: "This automation cannot run: " + problems.join("; ") + ". It stays off.", problems } }, 422);
      }
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
