import { approveChaserTemplateRequestSchema } from "@asap/schema";
import { Hono } from "hono";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * Standing approvals of routine insurer chasers (D-147). A person approves the exact wording once;
 * withdrawing it stops every send under it. Sending stays off until the brokerage sets
 * `insurer_chasers` to act within rules.
 */
export function chaserRoutes() {
  const app = new Hono();

  app.get("/chaser-templates", async (c) => {
    const { db } = c.get("auth");
    const r = await db.from("chaser_templates").select("id, purpose, version, subject_template, body_template, min_days_between, approved_by, approved_at, retired_at").order("approved_at", { ascending: false });
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    return c.json({ templates: r.data ?? [] });
  });

  app.post("/chaser-templates", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, approveChaserTemplateRequestSchema);
    const org = requireActiveOrganization(await resolveContext(db, user.id));
    const { data, error } = await db.rpc("chaser_template_approve", { p_organization_id: org.id, p_purpose: input.purpose, p_subject: input.subject, p_body: input.body, p_min_days: input.minDaysBetween });
    if (error) return sendError(c, mapDatabaseError(error));
    const r = data as { id: string; created: boolean; version?: number };
    return c.json({ outcome: r.created ? "approved" : "already", templateId: r.id, version: r.version ?? null }, r.created ? 201 : 200);
  });

  app.post("/chaser-templates/:id/withdraw", async (c) => {
    const { db } = c.get("auth");
    const { data, error } = await db.rpc("chaser_template_withdraw", { p_id: c.req.param("id") });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json({ outcome: (data as { changed: boolean }).changed ? "withdrawn" : "already" });
  });

  return app;
}
