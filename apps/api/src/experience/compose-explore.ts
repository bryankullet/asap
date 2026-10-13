import type { ExploreParams, PortfolioQuery } from "@asap/schema";
import { hasPermission } from "../context.js";
import { interpret, type Vocabulary } from "../living/interpret.js";
import { loadPortfolio, PORTFOLIO_BASIS } from "../living/portfolio.js";
import type { Env } from "../placement/service.js";
import { Composition, L, cut, fmtDate, money } from "./build.js";
import type { Composed } from "./types.js";

/**
 * "Show me motor policies expiring this month" (D-172): a table of the policy periods the window
 * selects, read under the viewer's session by the portfolio loader that already owns that question
 * (D-158). Filters are said as removable chips; a selected row opens its detail beside the table,
 * with the next useful step. Nothing is computed here that the records do not hold: the expiring
 * premium is the one recorded on the period, the renewal status is the work's own.
 */
export type ExploreState = { params: ExploreParams; selected: string | null; unclear: string | null };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const toQuery = (p: ExploreParams): PortfolioQuery => ({
  subject: "renewals",
  window: { from: p.from, to: p.to, label: p.windowLabel },
  groupBy: null,
  filters: { insurers: p.insurer ? [p.insurer] : [], classOfBusiness: p.classOfBusiness, premiumChange: null, mine: false, status: null },
  compare: [],
});

/** The default window when nothing is said: this month. */
export function defaultExplore(now: Date): ExploreParams {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: ymd(from), to: ymd(to), windowLabel: `in ${from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, classOfBusiness: null, overdueOnly: false, insurer: null };
}

/**
 * Applies a request to the current view. Our own words first (overdue, every class, every insurer),
 * then the portfolio interpreter for windows, classes and insurers by the brokerage's own names.
 */
export function refineExplore(base: ExploreParams, text: string, now: Date, vocab: Vocabulary): { params: ExploreParams; understood: string[]; unclear: string | null } {
  let p = { ...base };
  const understood: string[] = [];
  let rest = text;
  const take = (re: RegExp, f: () => void, said: string) => {
    if (re.test(rest)) {
      f();
      understood.push(said);
      rest = rest.replace(re, " ");
    }
  };
  take(/\b(include|show|with)\b[^.]*\bnot (yet )?overdue\b|\bnot only overdue\b|\bstop showing only overdue\b/i, () => (p.overdueOnly = false), "Overdue and not yet overdue");
  take(/\b(only|just)?\s*(show\s+)?(the\s+)?overdue( renewals| ones| policies)?\b/i, () => (p.overdueOnly = true), "Only overdue: ended and not renewed");
  take(/\b(all|any|every) class(es)?\b|\ball (kinds of )?cover\b/i, () => (p.classOfBusiness = null), "Every class");
  take(/\b(all|any|every) insurers?\b/i, () => (p.insurer = null), "Every insurer");
  const leftover = rest.replace(/\b(show|me|only|just|the|policies|policy|renewals?|please|and|also|now|that|are|with|those|ones)\b/gi, " ").trim();
  if (leftover) {
    const r = interpret(rest, toQuery(p), now, vocab);
    p = { ...p, from: r.query.window.from, to: r.query.window.to, windowLabel: r.query.window.label.slice(0, 80), classOfBusiness: r.query.filters.classOfBusiness, insurer: r.query.filters.insurers[0] ?? p.insurer };
    understood.push(...r.understood.map((u) => u.text));
    return { params: p, understood, unclear: r.unclear };
  }
  return { params: p, understood, unclear: null };
}

export async function composeExplore(env: Env, s: ExploreState, now: Date): Promise<Composed> {
  const c = new Composition();
  const facts = await loadPortfolio(env, toQuery(s.params));
  const today = ymd(now);
  const isOverdue = (r: { ends: string; taskStatus: string | null }) => r.ends < today && r.taskStatus !== "done";
  const rows = facts.rows.filter((r) => !s.params.overdueOnly || isOverdue(r)).sort((a, b) => a.ends.localeCompare(b.ends) || a.client.localeCompare(b.client));
  const statusWords = (r: (typeof rows)[number]) =>
    r.taskStatus === "done" ? "Renewed" : r.workItemId ? ({ needs_you: "Needs someone", with_party: "Waiting on others", in_progress: "ASAP is handling" } as Record<string, string>)[r.taskStatus ?? ""] ?? "Renewal open" : "No renewal open";

  const insurerName = s.params.insurer ? facts.vocab.insurers.find((i) => i.id === s.params.insurer)?.name ?? "One insurer" : null;
  const chips: { label: string; removeAction: string | null }[] = [{ label: `Ending ${s.params.windowLabel}`, removeAction: null }];
  if (s.params.classOfBusiness) chips.push({ label: s.params.classOfBusiness, removeAction: c.action("rm-class", "Every class", { kind: "experience.refine", text: "all classes" }) });
  if (insurerName) chips.push({ label: insurerName, removeAction: c.action("rm-insurer", "Every insurer", { kind: "experience.refine", text: "all insurers" }) });
  if (s.params.overdueOnly) chips.push({ label: "Overdue only", removeAction: c.action("rm-overdue", "Include not overdue", { kind: "experience.refine", text: "include not overdue" }) });
  const filters = c.put("filters", "FilterBar", {
    chips,
    basis: "Policy periods ending in this window, from this brokerage's records. Expiring premium as recorded on each period.",
    unclear: s.unclear,
    count: rows.length,
  }, { actions: chips.map((x) => x.removeAction) });

  const tableRows = rows.slice(0, 200).map((r) => {
    const ref = { type: "policy_period" as const, id: r.periodId, label: cut(`${r.client} · ${r.policy || r.classOfBusiness}`, 200) };
    c.allow(ref);
    return {
      ref,
      cells: { client: cut(r.client, 200), policy: r.policy || null, insurer: r.insurer, cls: r.classOfBusiness || null, ends: fmtDate(r.ends), premium: r.expiring ? money(r.expiring.amount, r.expiring.currency) : null, status: statusWords(r) },
      tone: isOverdue(r) ? ("red" as const) : new Date(`${r.ends}T00:00:00Z`).getTime() - now.getTime() < 14 * DAY && r.taskStatus !== "done" ? ("gold" as const) : null,
    };
  });
  const what = [s.params.classOfBusiness, s.params.overdueOnly ? "overdue" : null].filter(Boolean).join(", ");
  const table = c.put("policies", "RecordTable", {
    caption: `Policies ending ${s.params.windowLabel}${what ? ` · ${what}` : ""}`,
    columns: [
      { key: "client", label: "Client", align: "start" },
      { key: "policy", label: "Policy", align: "start" },
      { key: "insurer", label: "Insurer", align: "start" },
      { key: "cls", label: "Class", align: "start" },
      { key: "ends", label: "Ends", align: "start" },
      { key: "premium", label: "Expiring premium", align: "end" },
      { key: "status", label: "Renewal", align: "start" },
    ],
    rows: tableRows,
    selectable: true,
    emptyText: facts.unavailable.length
      ? "Part of the book could not be read for you, so this list may be incomplete."
      : `No policy period ${s.params.classOfBusiness ? `of ${s.params.classOfBusiness} ` : ""}${s.params.overdueOnly ? "that is overdue " : ""}ends ${s.params.windowLabel} in this brokerage's records.`,
    truncated: facts.truncated || rows.length > 200,
  }, { continuity: ["selection", "scroll", "sort"] });

  let detail = null;
  const sel = s.selected ? rows.find((r) => r.periodId === s.selected) ?? null : null;
  if (sel) {
    const ref = { type: "policy_period" as const, id: sel.periodId, label: cut(`${sel.client} · ${sel.policy || sel.classOfBusiness}`, 200) };
    const days = Math.ceil((new Date(`${sel.ends}T23:59:59Z`).getTime() - now.getTime()) / DAY);
    const renew = sel.workItemId
      ? c.action("open-renewal", "Work on this renewal", { kind: "experience.start", text: `Renew ${sel.client} ${sel.classOfBusiness}`.slice(0, 500), subject: { type: "work_item", id: sel.workItemId, label: null } })
      : c.action("renew", "Renew this policy", { kind: "experience.start", text: `Renew ${sel.client} ${sel.classOfBusiness}`.slice(0, 500), subject: ref }, { disabledReason: hasPermission(env.ctx, "policy", "edit") ? null : "Your role cannot start renewal work." });
    if (sel.workItemId) c.allow({ type: "work_item", id: sel.workItemId });
    const close = c.action("close", "Close", { kind: "ui.dismiss", node: "s-detail" });
    const periodSource = { label: "Policy period", reference: `${sel.policy || sel.classOfBusiness}, ending ${fmtDate(sel.ends)}`, documentId: null, recordedAt: null };
    detail = c.put("detail", "RecordDetail", {
      heading: sel.client,
      eyebrow: [sel.classOfBusiness, sel.policy].filter(Boolean).join(" · ").slice(0, 80) || null,
      facts: [
        { label: "Insurer", value: sel.insurer, source: null },
        { label: "Cover ends", value: `${fmtDate(sel.ends)} (${days >= 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`})`, source: periodSource },
        { label: "Expiring premium", value: sel.expiring ? money(sel.expiring.amount, sel.expiring.currency)! : "Not recorded on the period", source: sel.expiring ? periodSource : null },
        { label: "Renewal premium", value: sel.renewal ? money(sel.renewal.amount, sel.renewal.currency)! : "None yet", source: null },
        { label: "Renewal", value: statusWords(sel), source: null },
        { label: "Handled by", value: sel.owner ?? "Nobody assigned", source: null },
      ],
      note: sel.renewal ? PORTFOLIO_BASIS.slice(0, 500) : null,
    }, { actions: [renew, close], sources: [periodSource] });
  }

  return {
    title: cut(`Policies ending ${s.params.windowLabel}${s.params.classOfBusiness ? ` · ${s.params.classOfBusiness}` : ""}`, 200),
    progress: "working",
    primary: null,
    layout: L.table("root", L.stack("list", [filters, table], "tight"), detail),
    composition: c,
    missing: [],
    unavailable: facts.unavailable.map((u) => `Part of the book (${u.part}) could not be read for you.`),
  };
}
