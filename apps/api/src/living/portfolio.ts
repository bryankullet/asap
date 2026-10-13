import { createHash } from "node:crypto";
import { LIVING_REGISTRY, type LivingBlock, type LivingSurface, type PortfolioQuery } from "@asap/schema";
import { mapDatabaseError } from "../errors.js";
import type { Env } from "../placement/service.js";
import type { Unavailable } from "./facts.js";
import type { Vocabulary } from "./interpret.js";

/**
 * The renewal portfolio (D-158): the renewals a typed query selects, read under the viewer's own
 * session, grouped and totalled from records. Composition is deterministic; a request in plain
 * language changes only the query (interpret.ts), never a value.
 *
 * The renewal premium is read in one stated way, so a change is never a mystery: the premium the
 * insurer confirmed on a placement, else the expiring insurer's latest quote on the renewal, else
 * none. A change is computed only between amounts in the same currency. ASAP never picks a quote.
 */

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_WORDS: Record<string, [string, "green" | "gold" | "red" | "grey"]> = {
  needs_you: ["Needs someone", "gold"], with_party: ["Waiting on others", "gold"], in_progress: ["ASAP is handling", "green"], done: ["Done", "grey"],
};
export const PORTFOLIO_BASIS = "Renewal premium: what the insurer confirmed on a placement, else the expiring insurer's latest quote, else none yet. Changes compare amounts in the same currency only.";

export type PortfolioRow = {
  periodId: string; workItemId: string | null; client: string; policy: string; insurerId: string; insurer: string; classOfBusiness: string; ends: string;
  ownerId: string | null; owner: string | null; taskStatus: string | null;
  expiring: { amount: number; currency: string } | null; renewal: { amount: number; currency: string } | null; renewalBasis: "placed" | "expiring_insurer_quote" | "none";
};
export type PortfolioFacts = { rows: PortfolioRow[]; vocab: Vocabulary; viewerId: string; unavailable: Unavailable[]; truncated: boolean };

const LIMIT = 500;

/** The brokerage's own words for insurers and classes — what a request may name. */
export async function loadVocabulary(env: Env): Promise<Vocabulary> {
  const [ins, cls] = await Promise.all([
    env.db.from("insurers").select("id, name").eq("organization_id", env.organizationId).is("deleted_at", null).order("name").limit(200),
    env.db.from("policies").select("class_of_business").eq("organization_id", env.organizationId).is("deleted_at", null).limit(1000),
  ]);
  if (ins.error) throw mapDatabaseError(ins.error);
  if (cls.error) throw mapDatabaseError(cls.error);
  return {
    insurers: (ins.data ?? []) as { id: string; name: string }[],
    classes: [...new Set(((cls.data ?? []) as { class_of_business: string | null }[]).map((r) => r.class_of_business).filter((c): c is string => !!c))].slice(0, 100),
  };
}

export async function loadPortfolio(env: Env, q: PortfolioQuery): Promise<PortfolioFacts> {
  const { db, organizationId: org } = env;
  const gaps: Unavailable[] = [];
  const vocab = await loadVocabulary(env);
  const p = await db
    .from("policy_periods")
    .select("id, period_end, premium_amount, premium_currency, policies!inner(id, policy_number, class_of_business, insurer_id, deleted_at, clients(name), insurers(name))")
    .eq("organization_id", org)
    .gte("period_end", q.window.from)
    .lte("period_end", q.window.to)
    .is("policies.deleted_at", null)
    .order("period_end")
    .limit(LIMIT + 1);
  if (p.error) throw mapDatabaseError(p.error);
  type PRow = { id: string; period_end: string; premium_amount: string | null; premium_currency: string | null; policies: { id: string; policy_number: string | null; class_of_business: string; insurer_id: string; clients: { name: string } | null; insurers: { name: string } | null } };
  const periods = (p.data ?? []) as unknown as PRow[];
  const truncated = periods.length > LIMIT;
  const ids = periods.slice(0, LIMIT).map((r) => r.id);

  const read = async <T>(part: Unavailable["part"], query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    const r = await query;
    if (r.error) { gaps.push({ part, reason: (r.error as { code?: string }).code === "42501" ? "restricted" : "failed" }); return []; }
    return (r.data ?? []) as T[];
  };
  const items = ids.length
    ? await read<{ id: string; policy_period_id: string; owner_id: string | null; task_status: string }>("run", db.from("work_items").select("id, policy_period_id, owner_id, task_status").eq("organization_id", org).eq("kind", "renewal").is("deleted_at", null).in("policy_period_id", ids))
    : [];
  const itemByPeriod = new Map(items.map((w) => [w.policy_period_id, w]));
  const itemIds = items.map((w) => w.id);
  const opps = itemIds.length ? await read<{ id: string; work_item_id: string }>("quotation", db.from("opportunities").select("id, work_item_id").eq("organization_id", org).in("work_item_id", itemIds)) : [];
  const oppIds = opps.map((o) => o.id);
  const [responses, placements] = oppIds.length
    ? await Promise.all([
        read<{ opportunity_id: string; outcome: string; premium_amount: string | null; premium_currency: string | null; opportunity_insurers: { insurer_id: string } | null }>("quotation",
          db.from("insurer_responses").select("opportunity_id, outcome, premium_amount, premium_currency, opportunity_insurers(insurer_id)").eq("organization_id", org).in("opportunity_id", oppIds)),
        read<{ id: string; opportunity_id: string; created_at: string }>("placement", db.from("placements").select("id, opportunity_id, created_at").eq("organization_id", org).in("opportunity_id", oppIds).order("created_at", { ascending: false })),
      ])
    : [[], []];
  const placementIds = placements.map((x) => x.id);
  const confirmations = placementIds.length
    ? await read<{ placement_id: string; confirmed_premium_amount: string | null; confirmed_premium_currency: string | null; outcome: string }>("placement",
        db.from("placement_insurer_responses").select("placement_id, outcome, confirmed_premium_amount, confirmed_premium_currency").eq("organization_id", org).in("placement_id", placementIds))
    : [];
  const ownerIds = [...new Set(items.map((w) => w.owner_id).filter((x): x is string => !!x))];
  const owners = ownerIds.length ? await read<{ id: string; display_name: string | null; full_name: string | null }>("owner", db.from("users").select("id, display_name, full_name").in("id", ownerIds)) : [];

  const oppByItem = new Map(opps.map((o) => [o.work_item_id, o.id]));
  const placementByOpp = new Map<string, string>();
  for (const pl of placements) if (!placementByOpp.has(pl.opportunity_id)) placementByOpp.set(pl.opportunity_id, pl.id);
  const rows: PortfolioRow[] = periods.slice(0, LIMIT).map((r) => {
    const w = itemByPeriod.get(r.id) ?? null;
    const oppId = w ? oppByItem.get(w.id) ?? null : null;
    let renewal: PortfolioRow["renewal"] = null;
    let basis: PortfolioRow["renewalBasis"] = "none";
    const plId = oppId ? placementByOpp.get(oppId) : undefined;
    const conf = plId ? confirmations.find((c) => c.placement_id === plId && c.confirmed_premium_amount && c.outcome.startsWith("confirmed")) : undefined;
    if (conf?.confirmed_premium_amount && conf.confirmed_premium_currency) {
      renewal = { amount: Number(conf.confirmed_premium_amount), currency: conf.confirmed_premium_currency };
      basis = "placed";
    } else if (oppId) {
      const same = responses.find((x) => x.opportunity_id === oppId && x.outcome === "quoted" && x.opportunity_insurers?.insurer_id === r.policies.insurer_id && x.premium_amount && x.premium_currency);
      if (same) { renewal = { amount: Number(same.premium_amount), currency: same.premium_currency! }; basis = "expiring_insurer_quote"; }
    }
    const owner = w?.owner_id ? owners.find((o) => o.id === w.owner_id) : undefined;
    return {
      periodId: r.id, workItemId: w?.id ?? null, client: r.policies.clients?.name ?? "A client", policy: r.policies.policy_number ?? "No policy number",
      insurerId: r.policies.insurer_id, insurer: r.policies.insurers?.name ?? "An insurer", classOfBusiness: r.policies.class_of_business ?? "Unclassified", ends: r.period_end,
      ownerId: w?.owner_id ?? null, owner: owner ? owner.display_name ?? owner.full_name ?? "A colleague" : null, taskStatus: w?.task_status ?? null,
      expiring: r.premium_amount && r.premium_currency ? { amount: Number(r.premium_amount), currency: r.premium_currency } : null,
      renewal, renewalBasis: basis,
    };
  });
  return { rows, vocab, viewerId: env.userId, unavailable: gaps, truncated };
}

function direction(r: PortfolioRow): "increase" | "decrease" | "same" | "unknown" {
  if (!r.expiring || !r.renewal || r.expiring.currency !== r.renewal.currency) return "unknown";
  return r.renewal.amount > r.expiring.amount ? "increase" : r.renewal.amount < r.expiring.amount ? "decrease" : "same";
}
function changeText(r: PortfolioRow): string | null {
  if (direction(r) === "unknown") return null;
  const d = r.renewal!.amount - r.expiring!.amount;
  const pct = r.expiring!.amount > 0 ? ` (${d >= 0 ? "+" : "−"}${Math.abs((d / r.expiring!.amount) * 100).toFixed(1)}%)` : "";
  return d === 0 ? "No change" : `${d > 0 ? "+" : "−"}${money(Math.abs(d), r.renewal!.currency)}${pct}`;
}

/** Applies the query's filters to the rows read for its window. */
export function select(f: PortfolioFacts, q: PortfolioQuery): PortfolioRow[] {
  return f.rows.filter((r) => {
    if (q.filters.insurers.length && !q.filters.insurers.includes(r.insurerId)) return false;
    if (q.compare.length && !q.compare.includes(r.insurerId)) return false;
    if (q.filters.classOfBusiness && r.classOfBusiness.toLowerCase() !== q.filters.classOfBusiness.toLowerCase()) return false;
    if (q.filters.mine && r.ownerId !== f.viewerId) return false;
    const st = r.taskStatus ?? "not_started";
    if (q.filters.status && (q.filters.status === "not_started" ? r.workItemId !== null : q.filters.status === "needs_me" ? st !== "needs_you" : st !== q.filters.status)) return false;
    const dir = direction(r);
    if (q.filters.premiumChange === "increase" && dir !== "increase") return false;
    if (q.filters.premiumChange === "decrease" && dir !== "decrease") return false;
    if (q.filters.premiumChange === "changed" && !(dir === "increase" || dir === "decrease")) return false;
    if (q.filters.premiumChange === "unknown" && dir !== "unknown") return false;
    return true;
  });
}

const totals = (xs: ({ amount: number; currency: string } | null)[]) => {
  const by = new Map<string, number>();
  for (const x of xs) if (x) by.set(x.currency, (by.get(x.currency) ?? 0) + x.amount);
  return [...by.entries()].slice(0, 4).map(([c, a]) => money(a, c));
};
const groupKey = (r: PortfolioRow, g: PortfolioQuery["groupBy"]): [string, string] => {
  switch (g) {
    case "insurer": return [r.insurerId, r.insurer];
    case "class": return [r.classOfBusiness.toLowerCase(), r.classOfBusiness];
    case "owner": return [r.ownerId ?? "none", r.owner ?? "No owner yet"];
    case "client": return [r.client.toLowerCase(), r.client];
    case "month": { const d = new Date(`${r.ends}T12:00:00Z`); return [r.ends.slice(0, 7), d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })]; }
    case "status": { const s = r.taskStatus ?? "not_started"; return [s, s === "not_started" ? "Not started" : STATUS_WORDS[s]?.[0] ?? s]; }
    default: return ["all", "All renewals"];
  }
};

const block = (id: string, component: LivingBlock["component"], role: LivingBlock["role"], title: string | null, props: Record<string, unknown>, actions: LivingBlock["actions"] = []): LivingBlock =>
  ({ id, component, version: LIVING_REGISTRY[component].version, role, title, props, evidence: [], actions, hash: hash({ props, actions }) });

export function chipsOf(q: PortfolioQuery, vocab: Vocabulary) {
  const name = (id: string) => vocab.insurers.find((i) => i.id === id)?.name ?? "An insurer";
  type Chip = { kind: "window" | "group" | "filter" | "compare"; field: "window" | "groupBy" | "compare" | "insurers" | "classOfBusiness" | "premiumChange" | "status" | "mine"; text: string; removable: boolean };
  const chips: Chip[] = [{ kind: "window", field: "window", text: `Ending ${q.window.label}`, removable: false }];
  if (q.compare.length) chips.push({ kind: "compare", field: "compare", text: `Comparing ${q.compare.map(name).join(" and ")}`, removable: true });
  else if (q.groupBy) chips.push({ kind: "group", field: "groupBy", text: `Grouped by ${q.groupBy === "class" ? "class of business" : q.groupBy}`, removable: true });
  if (q.filters.insurers.length) chips.push({ kind: "filter", field: "insurers", text: `Only ${q.filters.insurers.map(name).join(", ")}`.slice(0, 200), removable: true });
  if (q.filters.classOfBusiness) chips.push({ kind: "filter", field: "classOfBusiness", text: `Only ${q.filters.classOfBusiness}`.slice(0, 200), removable: true });
  if (q.filters.premiumChange) chips.push({ kind: "filter", field: "premiumChange", text: { increase: "Premium increases", decrease: "Premium decreases", changed: "Premium changed", unknown: "No renewal premium yet" }[q.filters.premiumChange], removable: true });
  if (q.filters.status) chips.push({ kind: "filter", field: "status", text: { needs_me: "Needs me", with_party: "Waiting on others", in_progress: "ASAP is handling", done: "Done", not_started: "Not started" }[q.filters.status], removable: true });
  if (q.filters.mine) chips.push({ kind: "filter", field: "mine", text: "Only mine", removable: true });
  return chips;
}

export function composePortfolio(f: PortfolioFacts, q: PortfolioQuery, opts: { now: Date; aiAvailable: boolean; unclear?: string | null; clarify?: { question: string; options: { label: string; text: string }[] } | null }): LivingSurface {
  const rows = select(f, q);
  const groups = new Map<string, { label: string; rows: PortfolioRow[] }>();
  for (const r of rows) {
    const [k, l] = groupKey(r, q.groupBy);
    const g = groups.get(k) ?? { label: l, rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => (q.groupBy === "month" ? a[0].localeCompare(b[0]) : b[1].rows.length - a[1].rows.length || a[1].label.localeCompare(b[1].label)));
  const title = `Renewals ending ${q.window.label}`;
  const blocks: LivingBlock[] = [
    block("header", "ContextHeader", "lead", null, {
      eyebrow: "Portfolio",
      title,
      client: null,
      facts: [
        { label: "Renewals", value: String(rows.length) },
        { label: "Premium increases", value: String(rows.filter((r) => direction(r) === "increase").length) },
        { label: "Premium decreases", value: String(rows.filter((r) => direction(r) === "decrease").length) },
        { label: "No renewal premium yet", value: String(rows.filter((r) => direction(r) === "unknown").length) },
      ],
      status: { label: f.truncated ? `First ${LIMIT} shown` : `${rows.length} selected`, tone: f.truncated ? "gold" : "green" },
      owner: null,
    }),
    block("query", "QueryInterpretation", "lead", null, { chips: chipsOf(q, f.vocab), unclear: opts.unclear ?? null, clarify: opts.clarify ?? null, basis: PORTFOLIO_BASIS }),
    block("groups", "PortfolioGroups", "main", null, {
      groups: ordered.slice(0, 40).map(([key, g]) => ({
        key: key.slice(0, 200),
        label: g.label.slice(0, 200),
        count: g.rows.length,
        expiringTotals: totals(g.rows.map((r) => r.expiring)),
        renewalTotals: totals(g.rows.map((r) => r.renewal)),
        increases: g.rows.filter((r) => direction(r) === "increase").length,
        decreases: g.rows.filter((r) => direction(r) === "decrease").length,
        unknown: g.rows.filter((r) => direction(r) === "unknown").length,
        rows: g.rows.slice(0, 100).map((r) => ({
          periodId: r.periodId, workItemId: r.workItemId, client: r.client.slice(0, 200), policy: r.policy.slice(0, 200), insurer: r.insurer.slice(0, 200), classOfBusiness: r.classOfBusiness.slice(0, 100), ends: r.ends,
          owner: r.owner, status: r.taskStatus ? STATUS_WORDS[r.taskStatus]?.[0] ?? r.taskStatus : "Not started", statusTone: r.taskStatus ? STATUS_WORDS[r.taskStatus]?.[1] ?? "grey" : "grey",
          expiring: r.expiring ? money(r.expiring.amount, r.expiring.currency) : null, renewal: r.renewal ? money(r.renewal.amount, r.renewal.currency) : null,
          renewalBasis: r.renewalBasis, change: changeText(r), direction: direction(r),
        })),
        more: Math.max(0, g.rows.length - 100),
      })),
      selected: rows.length,
      comparing: q.compare.length > 0,
    }),
  ];
  return {
    version: 1,
    // One identity across refinements: blocks reconcile in place and the arrangement carries over.
    surfaceId: "portfolio:renewals",
    purpose: "portfolio",
    subject: { kind: "portfolio", id: hash(q), title: title.slice(0, 200) },
    stage: null,
    generatedAt: opts.now.toISOString(),
    fingerprint: hash([blocks.map((b) => [b.id, b.hash]), f.unavailable]),
    blocks,
    ai: { available: opts.aiAvailable },
    unavailable: f.unavailable.map((g) => ({ part: g.part === "run" ? "Renewal work" : g.part === "quotation" ? "Quotations" : g.part === "placement" ? "Placements" : "Owners", reason: g.reason })),
  };
}
