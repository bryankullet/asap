import { homeChangesResponseSchema, livingSurfaceSchema, workspaceFocusSchema, workspaceInterpretationSchema, workspaceInterpretRequestSchema, type AiProvider, type WorkspaceFocus, portfolioRequestSchema, portfolioResponseSchema, surfaceKeySchema, surfacePreferencesResponseSchema, surfacePreferencesSchema } from "@asap/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { loadRenewalLivingFacts } from "../living/facts.js";
import { homeChanges } from "../living/home.js";
import { interpretWorkspace } from "../living/ask-workspace.js";
import { applyFocus, renewalAnswer, renewalVocabulary, servicingAnswer, servicingVocabulary } from "../living/focus.js";
import { defaultQuery, interpret } from "../living/interpret.js";
import { composePortfolio, loadPortfolio, loadVocabulary } from "../living/portfolio.js";
import { composeClaimSurface, composeEndorsementSurface, loadServicingFacts, loadWorkItem } from "../living/servicing.js";
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
export function livingRoutes(deps: { logger: Logger; aiAvailable: boolean; provider: AiProvider | null }) {
  const app = new Hono();

  const envOf = async (c: Context): Promise<Env> => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return { db, ctx, organizationId: org.id, userId: user.id, audit: (entry) => recordAudit(db, deps.logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }) };
  };

  /** One route, one contract: the work's own kind decides which composition it gets (D-161). */
  async function composeFor(env: Env, workItemId: string, opts: { explore: string[]; focus: WorkspaceFocus | null; question: string | null; source: "rules" | "model" }) {
    if (!/^[0-9a-f-]{36}$/i.test(workItemId)) throw new HttpError(404, "not_found", "That work is not available.");
    const item = await loadWorkItem(env, workItemId);
    const now = new Date();
    if (item.kind === "renewal") {
      const facts = await loadRenewalLivingFacts(env, workItemId);
      let surface = composeRenewalSurface(facts, { now, aiAvailable: deps.aiAvailable, explore: opts.explore });
      if (opts.focus && opts.focus.intent !== "reset" && opts.focus.intent !== "explore") surface = applyFocus(surface, opts.question ?? opts.focus.intent, renewalAnswer(facts, opts.focus, now), opts.source);
      return { surface, kind: "renewal" as const, vocab: renewalVocabulary(facts) };
    }
    if (item.kind === "claim" || item.kind === "endorsement") {
      const facts = await loadServicingFacts(env, item);
      let surface = item.kind === "claim" ? composeClaimSurface(facts, { now, aiAvailable: deps.aiAvailable }) : composeEndorsementSurface(facts, { now, aiAvailable: deps.aiAvailable });
      if (opts.focus && opts.focus.intent !== "reset") surface = applyFocus(surface, opts.question ?? opts.focus.intent, servicingAnswer(facts, opts.focus), opts.source);
      return { surface, kind: item.kind, vocab: servicingVocabulary(facts) };
    }
    throw new HttpError(404, "not_found", "A living workspace is not composed for this kind of work yet.");
  }

  app.get("/living/:workItemId", async (c: Context) => {
    const env = await envOf(c);
    // Alternatives being explored (D-160) and a focus asked for (D-165) travel in the address:
    // ids and names only, never values. Refresh and Back reproduce the same composition.
    const explore = (c.req.query("explore") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 3);
    const parsedFocus = workspaceFocusSchema.safeParse({ intent: c.req.query("focus"), target: c.req.query("target") ?? null });
    const question = (c.req.query("fq") ?? "").slice(0, 500) || null;
    const source = c.req.query("fsrc") === "model" ? "model" : "rules";
    const { surface } = await composeFor(env, c.req.param("workItemId") ?? "", { explore, focus: parsedFocus.success ? parsedFocus.data : null, question, source });
    const definitions = await loadDefinitions(env.db, surface.blocks.map((b) => ({ component: b.component, version: b.version })));
    const result = validateSurface({ surface, definitions, permissions: env.ctx.permissions });
    if (!result.ok) {
      deps.logger.error({ workItemId: c.req.param("workItemId"), failures: result.failures }, "living surface rejected by the validator");
      throw new HttpError(422, "surface_invalid", "This workspace could not be composed");
    }
    return c.json(livingSurfaceSchema.parse(result.surface));
  });

  /**
   * `POST /living/:workItemId/interpret` — Ask ASAP inside a workspace (D-165). The request becomes
   * a typed focus from the record's own names: rules first, the model through the gateway only when
   * the rules find nothing. It writes nothing; the browser moves to the focused address.
   */
  app.post("/living/:workItemId/interpret", async (c: Context) => {
    const env = await envOf(c);
    const body = workspaceInterpretRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "invalid_request", "Say what you want to see.");
    const { kind, vocab } = await composeFor(env, c.req.param("workItemId") ?? "", { explore: [], focus: null, question: null, source: "rules" });
    const interpretation = await interpretWorkspace(body.data.text, kind, vocab, deps.provider, deps.logger);
    return c.json(workspaceInterpretationSchema.parse(interpretation));
  });

  /*
   * `POST /living/portfolio` — the renewal portfolio (D-158). The body carries the current view as a
   * typed query and, optionally, a request in plain language that refines it. The request changes
   * only the query (deterministically, interpret.ts); the rows, totals and changes are read from the
   * brokerage's records under the viewer's session, then validated like any surface.
   */
  app.post("/living/portfolio", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const env: Env = { db, ctx, organizationId: org.id, userId: user.id, audit: (entry) => recordAudit(db, deps.logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }) };
    const body = portfolioRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "invalid_request", "That is not a portfolio request.");
    const now = new Date();
    const base = body.data.query ?? defaultQuery(now);
    const interpretation = body.data.text?.trim()
      ? interpret(body.data.text, base, now, await loadVocabulary(env))
      : { query: base, understood: [], unclear: null, clarify: null };
    const facts = await loadPortfolio(env, interpretation.query);
    const surface = composePortfolio(facts, interpretation.query, { now, aiAvailable: deps.aiAvailable, unclear: interpretation.unclear, clarify: interpretation.clarify });
    const definitions = await loadDefinitions(db, surface.blocks.map((b) => ({ component: b.component, version: b.version })));
    const result = validateSurface({ surface, definitions, permissions: ctx.permissions });
    if (!result.ok) {
      deps.logger.error({ failures: result.failures }, "portfolio surface rejected by the validator");
      throw new HttpError(422, "surface_invalid", "This view could not be composed");
    }
    return c.json(portfolioResponseSchema.parse({ surface: result.surface, interpretation }));
  });

  /** `GET /home/changes` — what changed since this person last looked (D-159). */
  app.get("/home/changes", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const env: Env = { db, ctx, organizationId: org.id, userId: user.id, audit: (entry) => recordAudit(db, deps.logger, c, { ...entry, organizationId: org.id, actorUserId: user.id }) };
    return c.json(homeChangesResponseSchema.parse(await homeChanges(env, new Date())));
  });

  /*
   * One person's arrangement of one surface in their active brokerage (0080, D-157). The brokerage
   * and the person come from the session, never the request; RLS enforces the same scope again.
   */
  app.get("/surface-preferences/:surfaceKey", async (c) => {
    const { db, user } = c.get("auth");
    const org = requireActiveOrganization(await resolveContext(db, user.id));
    const key = surfaceKeySchema.safeParse(c.req.param("surfaceKey"));
    if (!key.success) throw new HttpError(400, "invalid_request", "That is not a surface.");
    const r = await db.from("surface_preferences").select("prefs, updated_at").eq("organization_id", org.id).eq("user_id", user.id).eq("surface_key", key.data).maybeSingle();
    if (r.error) throw mapDatabaseError(r.error);
    const stored = surfacePreferencesSchema.safeParse(r.data?.prefs ?? {});
    return c.json(surfacePreferencesResponseSchema.parse({ surfaceKey: key.data, prefs: stored.success ? stored.data : surfacePreferencesSchema.parse({}), updatedAt: r.data?.updated_at ?? null }));
  });

  app.put("/surface-preferences/:surfaceKey", async (c) => {
    const { db, user } = c.get("auth");
    const org = requireActiveOrganization(await resolveContext(db, user.id));
    const key = surfaceKeySchema.safeParse(c.req.param("surfaceKey"));
    if (!key.success) throw new HttpError(400, "invalid_request", "That is not a surface.");
    const body = surfacePreferencesSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "invalid_request", "Those preferences are not valid.");
    const r = await db.from("surface_preferences")
      .upsert({ organization_id: org.id, user_id: user.id, surface_key: key.data, prefs: body.data, updated_at: new Date().toISOString() }, { onConflict: "organization_id,user_id,surface_key" })
      .select("prefs, updated_at").single();
    if (r.error) throw mapDatabaseError(r.error);
    return c.json(surfacePreferencesResponseSchema.parse({ surfaceKey: key.data, prefs: body.data, updatedAt: r.data.updated_at }));
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
