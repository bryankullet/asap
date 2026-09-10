import {
  ATTENTION_SECTION_LABELS,
  CLIENT_COLUMNS,
  INSURER_COLUMNS,
  POLICY_COLUMNS,
  POLICY_PERIOD_COLUMNS,
  RUN_COLUMNS,
  RunRow,
  WORK_ITEM_COLUMNS,
  WORK_VIEW_LABELS,
  WorkItemRow,
  attentionResponseSchema,
  runNeedsPerson,
  workListQuerySchema,
  workListResponseSchema,
  type AttentionDegradation,
  type AttentionItem,
  type AttentionPeriod,
  type AttentionResponse,
  type AttentionRunFailure,
  type WorkListResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { compareItems, daysToEnd, factsFor, nowStepOf, scoreOf, signalsFor } from "../attention/signals.js";
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
    const degraded: AttentionDegradation[] = [];

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
    const inScope = [...needsYou, ...checksDue];

    // Context: the client and the client-policy-year, so a card can name what it is about.
    // A read that fails degrades the answer rather than failing it (§36 partial success).
    const clientNames = new Map<string, string>();
    const clientFileStatus = new Map<string, string>();
    const clientIds = [...new Set(inScope.map((i) => i.client_id).filter((v): v is string => v !== null))];
    if (clientIds.length > 0) {
      const r = await db.from("clients").select(CLIENT_COLUMNS).in("id", clientIds);
      if (r.error) {
        degraded.push({ what: "Client names", because: "The client rows could not be read." });
      } else {
        for (const row of (r.data ?? []) as { id: string; name: string; file_status: string }[]) {
          clientNames.set(row.id, row.name);
          clientFileStatus.set(row.id, row.file_status);
        }
      }
    }

    const periods = new Map<string, AttentionPeriod>();
    const periodIds = [...new Set(inScope.map((i) => i.policy_period_id).filter((v): v is string => v !== null))];
    if (periodIds.length > 0) {
      const pr = await db.from("policy_periods").select(POLICY_PERIOD_COLUMNS).in("id", periodIds);
      if (pr.error) {
        degraded.push({ what: "Periods of cover", because: "The policy period rows could not be read." });
      } else {
        const rows = (pr.data ?? []) as { id: string; policy_id: string; period_start: string; period_end: string }[];
        const policyIds = [...new Set(rows.map((p) => p.policy_id))];
        const [polR, insR] = await Promise.all([
          db.from("policies").select(POLICY_COLUMNS).in("id", policyIds),
          db.from("insurers").select(INSURER_COLUMNS).eq("organization_id", org.id),
        ]);
        const policies = polR.error ? [] : ((polR.data ?? []) as { id: string; class_of_business: string; policy_number: string | null; insurer_id: string }[]);
        const insurers = insR.error ? [] : ((insR.data ?? []) as { id: string; name: string }[]);
        if (polR.error || insR.error) {
          degraded.push({ what: "Policy details", because: "The policy or insurer rows could not be read." });
        }
        for (const p of rows) {
          const policy = policies.find((x) => x.id === p.policy_id);
          periods.set(p.id, {
            id: p.id,
            classOfBusiness: policy?.class_of_business ?? "This policy",
            insurerName: insurers.find((i) => i.id === policy?.insurer_id)?.name ?? "the insurer",
            policyNumber: policy?.policy_number ?? null,
            periodStart: p.period_start,
            periodEnd: p.period_end,
            daysToEnd: daysToEnd(p.period_end, now),
          });
        }
      }
    }

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
