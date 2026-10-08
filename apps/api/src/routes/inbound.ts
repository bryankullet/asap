import { inboundDecisionSchema, insurerContactRequestSchema, inboundMessageRequestSchema, inboundMessageResponseSchema } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { emitEvent } from "../events/emit.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { messageIdFor, parseEml } from "../inbound/eml.js";
import { fileAttachments } from "../inbound/attachments.js";
import { fileToRun } from "../inbound/router.js";
import { parseBody } from "./_parse.js";

/**
 * Inbound email for people (D-144). A pasted email or an uploaded .eml is recorded through
 * `inbound_message_record` as the signed-in person, then `email.received` is emitted exactly as a
 * mailbox sync emits it — the router cannot tell the two apart, which is the point. A person
 * settles an Unsorted email through `inbound_decide`; filing it to the run is then the engine's.
 */
export function inboundRoutes(deps: { logger: Logger; service: () => SupabaseClient; bucket: string }) {
  const app = new Hono();

  app.post("/inbound/messages", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, inboundMessageRequestSchema);
    const org = requireActiveOrganization(await resolveContext(db, user.id));
    const m = "eml" in input
      ? parseEml(input.eml)
      : { ...input, sentAt: input.receivedAt ?? null, messageId: messageIdFor(input.from, input.subject, input.body, input.receivedAt ?? ""), attachments: [] };
    if (!m.from) return sendError(c, new HttpError(422, "sender_required", "The email has no sender address ASAP can read."));
    const { data, error } = await db.rpc("inbound_message_record", {
      p_organization_id: org.id, p_from: m.from, p_to: m.to, p_cc: m.cc, p_subject: m.subject, p_body: m.body,
      p_sent_at: m.sentAt ?? new Date().toISOString(), p_message_id: m.messageId,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    const r = data as { id: string; created: boolean };
    const filed = r.created && m.attachments.length ? await fileAttachments(db, deps.logger, { organizationId: org.id, userId: user.id, bucket: deps.bucket, emailMessageId: r.id, attachments: m.attachments }) : [];
    if (r.created)
      await emitEvent(db, deps.logger, { organizationId: org.id, eventType: "email.received", entityType: "email_message", entityId: r.id, actor: "user", actorUserId: user.id, payload: { emailMessageId: r.id, source: "pasted", attachments: m.attachments.length }, dedupeKey: r.id });
    return c.json({ ...inboundMessageResponseSchema.parse({ outcome: r.created ? "recorded" : "already", emailMessageId: r.id }), attachments: filed }, r.created ? 201 : 200);
  });

  app.get("/inbound/messages/:id", async (c) => {
    const { db } = c.get("auth");
    const r = await db.from("inbound_classifications").select("id, email_message_id, kind, confidence, source, reason, candidates, state, routed_run_id, routed_by, work_item_id").eq("email_message_id", c.req.param("id")).maybeSingle();
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    if (!r.data) return c.json({ classification: null });
    const x = r.data as Record<string, unknown>;
    return c.json({ classification: { id: x["id"], emailMessageId: x["email_message_id"], kind: x["kind"], confidence: x["confidence"] === null ? null : Number(x["confidence"]), source: x["source"], reason: x["reason"], candidates: x["candidates"], state: x["state"], routedRunId: x["routed_run_id"], routedBy: x["routed_by"], workItemId: x["work_item_id"] } });
  });

  app.post("/inbound/messages/:id/decision", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, inboundDecisionSchema);
    const { data, error } = await db.rpc("inbound_decide", { p_email_message_id: id, p_decision: input.decision, p_run_id: input.decision === "route" ? input.runId : null, p_reason: input.decision === "dismiss" ? input.reason : null });
    if (error) return sendError(c, mapDatabaseError(error));
    const r = data as { state: string; changed: boolean };
    if (r.changed && input.decision === "route") {
      const svc = deps.service();
      const m = await svc.from("email_messages").select("id, organization_id, from_address, subject, sent_at").eq("id", id).maybeSingle();
      const msg = m.data as { id: string; organization_id: string; from_address: string; subject: string; sent_at: string } | null;
      if (msg) await fileToRun(svc, deps.logger, { organizationId: msg.organization_id, runId: input.runId, message: msg, kind: null, party: null, why: "Filed here by a person", by: "person", userId: user.id });
    }
    return c.json({ outcome: r.changed ? "done" : "already", state: r.state });
  });

  /** An insurer's verified address, recorded by a person with how they know it (D-145). */
  app.post("/insurers/:id/contacts", async (c) => {
    const { db } = c.get("auth");
    const input = await parseBody(c, insurerContactRequestSchema);
    const { data, error } = await db.rpc("insurer_contact_record", { p_insurer_id: c.req.param("id"), p_email: input.email, p_label: input.label ?? null, p_source: input.source });
    if (error) return sendError(c, mapDatabaseError(error));
    const r = data as { id: string; created: boolean };
    return c.json({ outcome: r.created ? "recorded" : "already", contactId: r.id }, r.created ? 201 : 200);
  });

  app.get("/insurers/:id/contacts", async (c) => {
    const { db } = c.get("auth");
    const r = await db.from("insurer_contacts").select("id, email, label, source, verified_at").eq("insurer_id", c.req.param("id")).is("retired_at", null).order("verified_at");
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    return c.json({ contacts: r.data ?? [] });
  });

  return app;
}
