import { askQuerySchema, askResponseSchema, type AskResponse, type AskResult } from "@asap/schema";
import { Hono } from "hono";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/** PostgREST pattern characters, so a typed `%` cannot widen the search. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Ask, Phase 1: search only. Reads through the caller's session (RLS applies), scoped again to the
 * active brokerage for members of several. Returns a UiIntent computed from the result count; no
 * model is involved and nothing here can act (spec Part 4.3).
 */
export function askRoutes() {
  const app = new Hono();

  app.get("/ask", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = askQuerySchema.safeParse({ q: c.req.query("q") ?? "" });
    if (!parsed.success) throw new HttpError(400, "validation_failed", "q is required");
    const q = parsed.data.q;

    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const { data, error } = await db
      .from("work_items")
      .select("id, title")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .ilike("title", `%${escapeLike(q)}%`)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) return sendError(c, mapDatabaseError(error));

    const results: AskResult[] = ((data ?? []) as { id: string; title: string }[]).map((r) => ({
      id: r.id,
      kind: "work_item",
      title: r.title,
      href: `/r/${r.id}`,
    }));

    const one = results.length === 1 ? results[0] : undefined;
    const body: AskResponse = askResponseSchema.parse({
      intent: {
        type: one ? "open_record" : results.length === 0 ? "answer" : "work_list",
        target: one?.id ?? null,
        panel: null,
        view: "summary",
        answer:
          results.length === 0
            ? `Nothing in ${org.name} matches "${q}".`
            : one
              ? `Opening ${one.title}.`
              : `${results.length} items match "${q}".`,
        suggestions: results.slice(0, 4).map((r) => r.title),
      },
      results,
      source: "search",
    });
    return c.json(body);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
