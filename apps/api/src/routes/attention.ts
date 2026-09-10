import {
  ATTENTION_SECTION_LABELS,
  RUN_COLUMNS,
  RunRow,
  WORK_ITEM_COLUMNS,
  WORK_VIEW_LABELS,
  WorkItemRow,
  attentionResponseSchema,
  runNeedsPerson,
  workListQuerySchema,
  workListResponseSchema,
  type AttentionItem,
  type AttentionResponse,
  type AttentionRunFailure,
  type WorkListResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/** The default cap. §42: "every list endpoint returns a ranked, capped default with a summary". */
const ATTENTION_CAP = 25;

/** The step a person or a party is waiting on, named so a card need not re-derive it. */
function nowStep(item: WorkItemRow) {
  const s = item.steps.find((x) => x.state === "now" || x.state === "blocked");
  return s ? { id: s.id, label: s.label, actor: s.actor } : null;
}

function failure(run: RunRow): AttentionRunFailure {
  return {
    id: run.id,
    title: run.title,
    status: run.status as AttentionRunFailure["status"],
    nextStep: run.next_step,
  };
}

/**
 * Today (`GET /attention`) and Work (`GET /work`), resolved server-side.
 *
 * Both read through the caller's session, so RLS decides what exists before anything is ranked:
 * a row the caller cannot see is not returned, not counted and not hinted at. The organization is
 * resolved from the session and scoped again in the query (§45 rule 5) — the browser supplies
 * neither it nor a role.
 */
export function attentionRoutes() {
  const app = new Hono();

  /** Open items and their runs, under RLS, for the caller's active brokerage. */
  async function load(db: SupabaseClient, orgId: string) {
    const [itemsR, runsR] = await Promise.all([
      db
        .from("work_items")
        .select(WORK_ITEM_COLUMNS)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      db
        .from("runs")
        .select(RUN_COLUMNS)
        .eq("organization_id", orgId)
        .order("started_at", { ascending: false }),
    ]);
    if (itemsR.error) throw mapDatabaseError(itemsR.error);
    if (runsR.error) throw mapDatabaseError(runsR.error);
    return {
      items: WorkItemRow.array().parse(itemsR.data ?? []),
      runs: RunRow.array().parse(runsR.data ?? []),
    };
  }

  app.get("/attention", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    // The server's clock. A check being due is a fact about now, not about the visitor's device.
    const now = new Date();
    const generatedAt = now.toISOString();

    let loaded;
    try {
      loaded = await load(db, org.id);
    } catch (e) {
      if (e instanceof HttpError) return sendError(c, e);
      throw e;
    }
    const { items, runs } = loaded;

    const stuck = runs.filter(runNeedsPerson);
    const stuckByItem = new Map<string, RunRow>();
    for (const r of stuck) if (r.work_item_id && !stuckByItem.has(r.work_item_id)) stuckByItem.set(r.work_item_id, r);

    const needsYou = items.filter((i) => i.task_status === "needs_you");
    // Checks due: with another party, and the next check has passed on the server's clock.
    const checksDue = items.filter(
      (i) =>
        i.task_status === "with_party" && i.task_next_check !== null && new Date(i.task_next_check) <= now,
    );

    // Ranking: the section order the click-through document states, then recency inside it. No
    // invented importance score — §27's weighted score is architecture Phase 4, with detectors.
    const rank = (rows: WorkItemRow[], section: AttentionItem["section"]): AttentionItem[] =>
      rows.slice(0, ATTENTION_CAP).map((item, i) => ({
        section,
        rank: i + 1,
        item,
        reason: item.reason ?? `${nowStep(item)?.label ?? "This item"} is the step waiting.`,
        nowStep: nowStep(item),
        runFailure: stuckByItem.has(item.id) ? failure(stuckByItem.get(item.id)!) : null,
      }));

    const needsYouIds = new Set(needsYou.map((i) => i.id));
    const body: AttentionResponse = attentionResponseSchema.parse({
      organization: { id: org.id, name: org.name },
      generatedAt,
      items: [...rank(needsYou, "needs_you"), ...rank(checksDue, "checks_due")],
      sections: [
        {
          key: "needs_you",
          label: ATTENTION_SECTION_LABELS.needs_you,
          visible: needsYou.length,
          returned: Math.min(needsYou.length, ATTENTION_CAP),
        },
        {
          key: "checks_due",
          label: ATTENTION_SECTION_LABELS.checks_due,
          visible: checksDue.length,
          returned: Math.min(checksDue.length, ATTENTION_CAP),
        },
      ],
      // A stopped run with no item of its own would otherwise be reachable nowhere.
      orphanRuns: stuck
        .filter((r) => !r.work_item_id || !needsYouIds.has(r.work_item_id))
        .map(failure),
      cap: ATTENTION_CAP,
    });
    return c.json(body);
  });

  app.get("/work", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const q = workListQuerySchema.parse({
      view: c.req.query("view"),
      limit: c.req.query("limit"),
    });
    const generatedAt = new Date().toISOString();

    let loaded;
    try {
      loaded = await load(db, org.id);
    } catch (e) {
      if (e instanceof HttpError) return sendError(c, e);
      throw e;
    }
    const { items, runs } = loaded;
    const stuckByItem = new Map<string, RunRow>();
    for (const r of runs.filter(runNeedsPerson))
      if (r.work_item_id && !stuckByItem.has(r.work_item_id)) stuckByItem.set(r.work_item_id, r);

    // The same four views, with the same membership rules the browser applied.
    const inView = items.filter((i) => {
      if (q.view === "needs") return i.task_status === "needs_you";
      if (q.view === "with") return i.task_status === "with_party";
      if (q.view === "done") return i.task_status === "done";
      return i.task_status !== "done";
    });

    const body: WorkListResponse = workListResponseSchema.parse({
      organization: { id: org.id, name: org.name },
      view: q.view,
      label: WORK_VIEW_LABELS[q.view],
      generatedAt,
      items: inView.slice(0, q.limit).map((item, i) => ({
        rank: i + 1,
        item,
        reason: item.reason ?? `${nowStep(item)?.label ?? "This item"} is the step waiting.`,
        nowStep: nowStep(item),
        runFailure: stuckByItem.has(item.id) ? failure(stuckByItem.get(item.id)!) : null,
      })),
      visible: inView.length,
      returned: Math.min(inView.length, q.limit),
      cap: q.limit,
    });
    return c.json(body);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
