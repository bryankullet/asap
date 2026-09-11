import {
  ATTENTION_SECTION_LABELS,
  DRAFT_COLUMNS,
  DraftRow,
  RUN_COLUMNS,
  RunRow,
  WORK_ITEM_COLUMNS,
  WORK_VIEW_LABELS,
  WorkView,
  WorkItemRow,
  attentionResponseSchema,
  runNeedsPerson,
  workListQuerySchema,
  workListResponseSchema,
  type AttentionDegradation,
  type AttentionItem,
  type AttentionResponse,
  type AttentionRunFailure,
  type WorkListResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { compareItems, factsFor, nowStepOf, scoreOf, signalsFor } from "../attention/signals.js";
import { loadRecordContext } from "../attention/record-context.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/** The default cap. §42: "every list endpoint returns a ranked, capped default with a summary". */
const ATTENTION_CAP = 12;

/** The step a person or a party is waiting on, named so a card need not re-derive it. */
function nowStep(item: WorkItemRow) {
  const s = nowStepOf(item);
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

const guardId = (g: WorkItemRow["steps"][number]["guards"][number]): string =>
  typeof g === "string" ? g : g.id;

/**
 * Discover (`GET /attention`) and Work (`GET /work`), resolved server-side.
 *
 * Both read through the caller's session, so RLS decides what exists before anything is ranked:
 * a row the caller cannot see is not returned, not counted and not hinted at. The organization is
 * resolved from the session and scoped again in the query (§45 rule 5) — the browser supplies
 * neither it nor a role.
 *
 * Discover ranks by the deterministic signals in `../attention/signals.ts`. No model authors a
 * score, a reason or a business value here; every number comes from a column.
 */
export function attentionRoutes() {
  const app = new Hono();

  /** Open items, their runs and their drafts, under RLS, for the caller's active brokerage. */
  async function load(db: SupabaseClient, orgId: string) {
    const [itemsR, runsR, draftsR] = await Promise.all([
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
      db
        .from("drafts")
        .select(DRAFT_COLUMNS)
        .eq("organization_id", orgId)
        .is("sent_at", null),
    ]);
    if (itemsR.error) throw mapDatabaseError(itemsR.error);
    if (runsR.error) throw mapDatabaseError(runsR.error);
    if (draftsR.error) throw mapDatabaseError(draftsR.error);
    return {
      items: WorkItemRow.array().parse(itemsR.data ?? []),
      runs: RunRow.array().parse(runsR.data ?? []),
      /** Prepared and not yet recorded as sent: the "For review" view is derived from these. */
      unsentDrafts: DraftRow.array().parse(draftsR.data ?? []),
    };
  }

  app.get("/attention", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    // The server's clock. A check being due is a fact about now, not about the visitor's device.
    const now = new Date();
    const generatedAt = now.toISOString();
    const degraded: AttentionDegradation[] = [];

    let loaded;
    try {
      loaded = await load(db, org.id);
    } catch (e) {
      if (e instanceof HttpError) return sendError(c, e);
      throw e;
    }
    const { items, runs } = loaded;

    /*
     * How much of a book exists at all. Two counts, under the caller's session, so a brand-new
     * brokerage is told it is new rather than told it is up to date (D-068). `head: true` asks for
     * the count without the rows.
     */
    const [clientsR, policiesR] = await Promise.all([
      db.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
      db.from("policies").select("id", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    ]);
    if (clientsR.error || policiesR.error) {
      degraded.push({ what: "How much is on file", because: "The client or policy counts could not be read." });
    }
    const book = {
      clients: clientsR.count ?? 0,
      policies: policiesR.count ?? 0,
      work: items.length,
    };

    const stuck = runs.filter(runNeedsPerson);
    const stuckByItem = new Map<string, RunRow>();
    for (const r of stuck) if (r.work_item_id && !stuckByItem.has(r.work_item_id)) stuckByItem.set(r.work_item_id, r);

    const needsYou = items.filter((i) => i.task_status === "needs_you");
    // Checks due: with another party, and the next check has passed on the server's clock.
    const checksDue = items.filter(
      (i) =>
        i.task_status === "with_party" && i.task_next_check !== null && new Date(i.task_next_check) <= now,
    );
    const inScope = [...needsYou, ...checksDue];

    // Context: the client and the client-policy-year, so a card can name what it is about.
    // Shared with /work and /runs, and it degrades rather than failing (§36 partial success).
    const context = await loadRecordContext(db, org.id, inScope, now);
    const { clientNames, clientFileStatus, periods } = context;
    degraded.push(...context.degraded);

    /** Score, explain and contextualise one section, then order it by the signal total. */
    const rank = (rows: WorkItemRow[], section: AttentionItem["section"]): AttentionItem[] => {
      const scored = rows.map((item) => {
        const period = item.policy_period_id ? (periods.get(item.policy_period_id) ?? null) : null;
        const facts = factsFor(item, period, now);
        const step = nowStepOf(item);
        const clientFileBlocking =
          item.kind === "placement" &&
          item.client_id !== null &&
          clientFileStatus.get(item.client_id) !== "cleared" &&
          (step?.guards ?? []).some((g) => guardId(g) === "client_file_cleared");
        const signals = signalsFor({
          item,
          failedRun: stuckByItem.get(item.id) ?? null,
          period,
          clientFileBlocking,
          facts,
          now,
        });
        return { item, period, facts, signals, score: scoreOf(signals) };
      });
      scored.sort(compareItems);
      return scored.slice(0, ATTENTION_CAP).map((s, i) => ({
        section,
        rank: i + 1,
        score: s.score,
        item: s.item,
        reason: s.item.reason ?? `${nowStep(s.item)?.label ?? "This item"} is the step waiting.`,
        signals: s.signals,
        nowStep: nowStep(s.item),
        client:
          s.item.client_id && clientNames.has(s.item.client_id)
            ? { id: s.item.client_id, name: clientNames.get(s.item.client_id)! }
            : null,
        period: s.period,
        facts: s.facts,
        runFailure: stuckByItem.has(s.item.id) ? failure(stuckByItem.get(s.item.id)!) : null,
        links: {
          work: `/r/${s.item.id}`,
          client: s.item.client_id ? `/files/${s.item.client_id}` : null,
          policy: s.period ? `/r/${s.period.id}?kind=policy` : null,
          // The words a person would type to reach this item in Ask.
          ask: s.item.title,
        },
      }));
    };

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
      degraded,
      cap: ATTENTION_CAP,
      book,
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
    const { items, runs, unsentDrafts } = loaded;
    const now = new Date(generatedAt);
    const stuckByItem = new Map<string, RunRow>();
    for (const r of runs.filter(runNeedsPerson))
      if (r.work_item_id && !stuckByItem.has(r.work_item_id)) stuckByItem.set(r.work_item_id, r);

    // "For review": ASAP prepared something and a person has not acted on it. Derived from the
    // drafts table, never stored, so it cannot drift from what is actually waiting.
    const awaitingReview = new Set(unsentDrafts.map((d) => d.work_item_id));

    const inView2 = (item: WorkItemRow, view: WorkListResponse["view"]): boolean => {
      if (view === "needs") return item.task_status === "needs_you";
      if (view === "with") return item.task_status === "with_party";
      if (view === "review") return awaitingReview.has(item.id) && item.task_status !== "done";
      if (view === "done") return item.task_status === "done";
      return item.task_status !== "done";
    };
    const inView = items.filter((i) => inView2(i, q.view));
    // Every tab's count, from the same read, so a number can never disagree with its list.
    const counts = Object.fromEntries(
      WorkView.options.map((v) => [v, items.filter((i) => inView2(i, v)).length]),
    );

    // Only the rows that will actually be returned are contextualised: resolving clients and
    // periods for rows the cap discards would be work nobody sees.
    const shown = inView.slice(0, q.limit);
    const context = await loadRecordContext(db, org.id, shown, now);

    const body: WorkListResponse = workListResponseSchema.parse({
      organization: { id: org.id, name: org.name },
      view: q.view,
      label: WORK_VIEW_LABELS[q.view],
      generatedAt,
      items: shown.map((item, i) => ({
        rank: i + 1,
        item,
        reason: item.reason ?? `${nowStep(item)?.label ?? "This item"} is the step waiting.`,
        nowStep: nowStep(item),
        runFailure: stuckByItem.has(item.id) ? failure(stuckByItem.get(item.id)!) : null,
        client:
          item.client_id && context.clientNames.has(item.client_id)
            ? { id: item.client_id, name: context.clientNames.get(item.client_id)! }
            : null,
        period: item.policy_period_id
          ? (context.periods.get(item.policy_period_id) ?? null)
          : null,
      })),
      visible: inView.length,
      returned: Math.min(inView.length, q.limit),
      cap: q.limit,
      counts,
      degraded: context.degraded,
    });
    return c.json(body);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
