import {
  SpaceView,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  spacePlanResponseSchema,
  type SpacePlanResponse,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { loadRenewalFacts, renewalPlan } from "../spaces/renewal.js";
import { loadDefinitions, validatePlan } from "../spaces/validate.js";

/**
 * `GET /spaces/:recordId?view=` — a validated Space plan (D-059).
 *
 *   plan → server-side validation against `component_definitions` → the browser renders it
 *
 * The plan is built from the recipes, deterministically. When a model produces one instead, only
 * the first arrow changes: the validator, the registry and this route stay exactly as they are.
 * A plan that fails validation is discarded and the route answers 422 with the rules it broke —
 * the browser shows a state, and never a half-validated Space.
 *
 * Only renewals are composed so far. Any other kind answers 404, so the existing record page
 * stays the only renderer for it (D-058: capabilities move one at a time).
 */
export function spaceRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/spaces/:recordId", async (c) => {
    const { db, user } = c.get("auth");
    const recordId = c.req.param("recordId");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const view = SpaceView.catch("summary").parse(c.req.query("view"));

    // Read under the caller's own session: RLS decides whether this record exists for them.
    const { data, error } = await db
      .from("work_items")
      .select(WORK_ITEM_COLUMNS)
      .eq("id", recordId)
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return sendError(c, mapDatabaseError(error));
    if (!data) throw new HttpError(404, "not_found", "No record with that id");
    const item = WorkItemRow.parse(data);
    if (item.kind !== "renewal") {
      throw new HttpError(404, "not_found", "No Space is composed for this kind of record yet");
    }

    const facts = await loadRenewalFacts(db, item);
    const plan = renewalPlan(facts, view);

    const definitions = await loadDefinitions(
      db,
      plan.blocks.map((b) => ({ component: b.component, version: b.version })),
    );
    const result = validatePlan({
      plan,
      record: item,
      definitions,
      permissions: ctx.permissions,
    });
    if (!result.ok) {
      // Our own plan failed our own validator: that is a defect in the recipe, not in the request.
      deps.logger.error(
        { recordId, view, failures: result.failures },
        "space plan rejected by the validator",
      );
      throw new HttpError(422, "plan_invalid", "This Space could not be composed");
    }

    const body: SpacePlanResponse = spacePlanResponseSchema.parse({
      plan: result.plan,
      registry: definitions.map((d) => ({ component: d.component_id, version: d.version })),
    });
    return c.json(body);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
