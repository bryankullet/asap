import {
  AiGatewayError,
  CONVERSATION_COLUMNS,
  CONVERSATION_MESSAGE_COLUMNS,
  askRequestSchema,
  askResponseV2Schema,
  conversationMessageSchema,
  conversationSchema,
  type AiProvider,
  type AskResponseV2,
  type AskScope,
} from "@asap/schema";
import { Hono } from "hono";
import type { Logger } from "pino";
import { runAsk } from "../ai/ask.js";
import { requireProvider } from "../ai/gateway.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/**
 * Ask ASAP — the conversation surface (Architecture §16, §18; Phase 5 of the UI plan).
 *
 * Three things are true of every request here and are enforced in this file rather than trusted:
 *
 *  - **The scope is resolved from a record the caller can already read.** The browser sends an id;
 *    the label comes from the row, under RLS. A scope that does not resolve is a 404, not a
 *    conversation about a record nobody can see.
 *  - **The transcript is not the database** (§45 rule 14). Messages are stored so a person can
 *    re-read what was asked. Nothing is read back out of them as a business fact — every value the
 *    UI shows is fetched by record id at render time.
 *  - **A missing model is a state, not an error.** With nothing configured, Ask returns
 *    `not_configured` with a 200 and the composer says a model has not been connected.
 */
export function conversationRoutes(deps: { logger: Logger; provider: AiProvider | null }) {
  const app = new Hono();
  const { logger } = deps;

  /** Resolves the scope label from the row itself. Returns null when the caller cannot read it. */
  async function resolveScope(
    db: Parameters<typeof resolveContext>[0],
    orgId: string,
    orgName: string,
    kind: AskScope["kind"],
    id: string | null,
  ): Promise<AskScope | null> {
    if (kind === "brokerage" || !id) return { kind: "brokerage", id: null, label: orgName };
    if (kind === "client") {
      const { data, error } = await db
        .from("clients")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw mapDatabaseError(error);
      const row = data as { id: string; name: string } | null;
      return row ? { kind: "client", id: row.id, label: row.name } : null;
    }
    const { data, error } = await db
      .from("work_items")
      .select("id, title")
      .eq("organization_id", orgId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    const row = data as { id: string; title: string } | null;
    return row ? { kind: "record", id: row.id, label: row.title } : null;
  }

  app.get("/conversations", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    // RLS already restricts this to the caller's own conversations; the filters are belt and
    // braces and make the intent readable at the call site.
    const { data, error } = await db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", org.id)
      .eq("created_by", user.id)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json({ conversations: conversationSchema.array().parse(data ?? []) });
  });

  app.get("/conversations/:id/messages", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("conversation_messages")
      .select(CONVERSATION_MESSAGE_COLUMNS)
      .eq("organization_id", org.id)
      .eq("conversation_id", c.req.param("id"))
      .order("seq", { ascending: true })
      .limit(200);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json({ messages: conversationMessageSchema.array().parse(data ?? []) });
  });

  app.post("/ask", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = askRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "A question is required.");
    const request = parsed.data;

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const scope = await resolveScope(db, org.id, org.name, request.scope.kind, request.scope.id);
    if (!scope) throw new HttpError(404, "not_found", "That record is not available.");

    // Configuration state first, so nothing is persisted for a question that was never asked.
    let provider: AiProvider;
    try {
      provider = requireProvider(deps.provider);
    } catch (err) {
      if (err instanceof AiGatewayError) {
        return c.json(
          askResponseV2Schema.parse({
            state: "not_configured",
            conversationId: request.conversationId,
            scope,
            message: null,
            planRecordId: null,
            planView: null,
            clarify: null,
            suggestions: [],
          }) satisfies AskResponseV2,
        );
      }
      throw err;
    }

    // The conversation, and the turns already in it. History is capped: a long transcript is a
    // record for a person to read, not context to resend in full.
    let conversationId = request.conversationId;
    let history: { role: "person" | "asap"; body: string }[] = [];
    let nextSeq = 0;
    if (conversationId) {
      const { data, error } = await db
        .from("conversation_messages")
        .select("seq, role, body")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: false })
        .limit(10);
      if (error) return sendError(c, mapDatabaseError(error));
      const rows = ((data ?? []) as { seq: number; role: "person" | "asap"; body: string }[]).reverse();
      history = rows.map((r) => ({ role: r.role, body: r.body }));
      nextSeq = rows.length > 0 ? Math.max(...rows.map((r) => r.seq)) + 1 : 0;
    } else {
      const { data, error } = await db
        .from("conversations")
        .insert({
          organization_id: org.id,
          created_by: user.id,
          // The title is the question as asked. A model never names a person's conversation.
          title: request.question.slice(0, 120),
          scope_kind: scope.kind,
          scope_id: scope.id,
        })
        .select("id")
        .single();
      if (error) return sendError(c, mapDatabaseError(error));
      conversationId = (data as { id: string }).id;
    }

    const askedAt = nextSeq;
    const { error: askErr } = await db.from("conversation_messages").insert({
      conversation_id: conversationId,
      organization_id: org.id,
      seq: askedAt,
      role: "person",
      body: request.question,
    });
    if (askErr) return sendError(c, mapDatabaseError(askErr));

    const scopeHint =
      scope.kind === "brokerage"
        ? `The broker is asking about ${org.name} as a whole.`
        : `The broker is looking at ${scope.kind === "client" ? "the client" : "the record"} "${scope.label}" (id ${scope.id}).`;

    let outcome;
    try {
      outcome = await runAsk({
        provider,
        question: request.question,
        history,
        scopeHint,
        db,
        organizationId: org.id,
        logger,
      });
    } catch (err) {
      if (err instanceof AiGatewayError) {
        // Honest failure. The question stays in the transcript — a person can see they asked it.
        logger.warn({ failure: err.failure }, "ask could not be served");
        return c.json(
          askResponseV2Schema.parse({
            state: err.failure === "not_configured" ? "not_configured" : "unavailable",
            conversationId,
            scope,
            message: null,
            planRecordId: null,
            planView: null,
            clarify: null,
            suggestions: [],
          }) satisfies AskResponseV2,
        );
      }
      throw err;
    }

    // Narrowed rather than a boolean, so the compiler enforces which fields each state carries.
    const answered = outcome.state === "answered" ? outcome : null;
    const abstained = outcome.state === "abstained" ? outcome : null;
    const { data: saved, error: saveErr } = await db
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        organization_id: org.id,
        seq: askedAt + 1,
        role: "asap",
        body: answered ? answered.intent.answer : (abstained?.reason ?? ""),
        intent: answered ? answered.intent : null,
        tools_used: outcome.toolsUsed,
        citations: answered ? answered.citations : [],
        abstained: abstained ? { reason: abstained.reason, missing: abstained.missing } : null,
        served_by: outcome.servedBy,
      })
      .select(CONVERSATION_MESSAGE_COLUMNS)
      .single();
    if (saveErr) return sendError(c, mapDatabaseError(saveErr));

    return c.json(
      askResponseV2Schema.parse({
        state: answered ? "answered" : "abstained",
        conversationId,
        scope,
        message: conversationMessageSchema.parse(saved),
        // The renderer reads the record by id; the plan carries no values from this response.
        planRecordId: answered ? answered.intent.target : null,
        planView: answered ? answered.intent.view : null,
        clarify: null,
        suggestions: answered ? answered.intent.suggestions : [],
      }) satisfies AskResponseV2,
    );
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
