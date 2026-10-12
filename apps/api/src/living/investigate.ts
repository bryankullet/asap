import { LIVING_REGISTRY, type LivingBlock, type LivingComponent, type LivingSurface } from "@asap/schema";
import { createHash } from "node:crypto";
import { hasPermission } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import type { Env } from "../placement/service.js";
import { arrivalsFrom, arrivedMailBlock, type Arrival, type Gap } from "./intelligence.js";

/**
 * A client investigation (D-167): one workspace looking across everything on file for one client —
 * open work and who holds it, cover on file per policy, claims, email waiting to be dealt with, and
 * what changed recently. Read under the viewer's session, composed deterministically, with the same
 * blocks and validator as every Living surface. It decides nothing and offers no command: each row
 * opens the governed place where that work is done.
 */

const DAY = 86_400_000;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmt = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const KIND: Record<string, string> = { renewal: "Renewal", claim: "Claim", endorsement: "Policy change", new_business: "New business", placement: "Placement", inbound: "Email", certificate: "Certificate", tor: "Time on risk" };

type Work = { id: string; title: string; kind: string; task_status: string; task_party: string | null; task_since: string | null; required_action: string | null; due_on: string | null };
/** A period of cover on file, with its policy: the cover list is periods, ending soonest first. */
type Period = { period_start: string; period_end: string; policies: { id: string; policy_number: string | null; class_of_business: string; insurers: { name: string } | null } };
type Claim = { id: string; work_item_id: string | null; incident_on: string | null; incident_summary: string | null; status: string; insurer_reference: string | null; policies: { policy_number: string | null } | null };
export type InvestigationFacts = {
  client: { id: string; name: string };
  work: Work[];
  /** Exact counts from the database, so a large client is never described by the rows loaded. */
  counts: { openWork: number | null; policies: number | null; inForce: number | null };
  periods: Period[];
  claims: Claim[];
  arrivals: Arrival[];
  recent: { at: string; action: string; actor: string }[];
  unavailable: Gap[];
};

async function read<T>(gaps: Gap[], part: string, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const r = await q;
  if (r.error) {
    gaps.push({ part, reason: (r.error as { code?: string }).code === "42501" ? "restricted" : "failed" });
    return null;
  }
  return r.data as T;
}

export async function loadInvestigation(env: Env, clientId: string): Promise<InvestigationFacts> {
  const { db, organizationId: org } = env;
  const c = await db.from("clients").select("id, name").eq("organization_id", org).eq("id", clientId).maybeSingle();
  if (c.error) throw mapDatabaseError(c.error);
  if (!c.data) throw new HttpError(404, "not_found", "That client is not available.");
  const gaps: Gap[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const count = async (part: string, q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    if (r.error) { gaps.push({ part, reason: (r.error as { code?: string }).code === "42501" ? "restricted" : "failed" }); return null; }
    return r.count ?? 0;
  };
  // The client's policies first, then their periods by id: filtering periods through an embedded
  // policy join is evaluated row by row under RLS across the whole brokerage, and was seconds slow.
  const policyRows = await read<Period["policies"][]>(gaps, "Cover on file", db.from("policies").select("id, policy_number, class_of_business, insurers(name)").eq("organization_id", org).eq("client_id", clientId).is("deleted_at", null).limit(1000));
  const policyIds = (policyRows ?? []).map((p) => p.id);
  const none = Promise.resolve({ data: [], error: null, count: 0 });
  const [work, periodRows, claims, openWork, policies, inForce] = await Promise.all([
    read<Work[]>(gaps, "Open work", db.from("work_items").select("id, title, kind, task_status, task_party, task_since, required_action, due_on").eq("organization_id", org).eq("client_id", clientId).neq("task_status", "done").is("deleted_at", null).order("updated_at", { ascending: false }).limit(60)),
    policyIds.length ? read<{ policy_id: string; period_start: string; period_end: string }[]>(gaps, "Cover on file", db.from("policy_periods").select("policy_id, period_start, period_end").eq("organization_id", org).in("policy_id", policyIds).gte("period_end", new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)).order("period_end").limit(12)) : none.then(() => []),
    read<Claim[]>(gaps, "Claims", db.from("claims").select("id, work_item_id, incident_on, incident_summary, status, insurer_reference, policies(policy_number)").eq("organization_id", org).eq("client_id", clientId).order("incident_on", { ascending: false }).limit(10)),
    count("Open work", db.from("work_items").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("client_id", clientId).neq("task_status", "done").is("deleted_at", null)),
    count("Cover on file", db.from("policies").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("client_id", clientId).is("deleted_at", null)),
    policyIds.length ? count("Cover on file", db.from("policy_periods").select("id", { count: "exact", head: true }).eq("organization_id", org).in("policy_id", policyIds).lte("period_start", today).gte("period_end", today)) : Promise.resolve(policyRows ? 0 : null),
  ]);
  const periods: Period[] = (periodRows ?? []).flatMap((r) => { const p = (policyRows ?? []).find((x) => x.id === r.policy_id); return p ? [{ period_start: r.period_start, period_end: r.period_end, policies: p }] : []; });
  const ids = (work ?? []).map((w) => w.id);
  const runs = ids.length ? await read<{ id: string; workflow: string; current_step: string | null; facts: Record<string, unknown> }[]>(gaps, "Email filed to this client's work", db.from("workflow_runs").select("id, workflow, current_step, facts").eq("organization_id", org).in("work_item_id", ids).not("state", "in", "(done,cancelled)")) : [];
  const arrivals = await arrivalsFrom(env, gaps, runs ?? []);
  let recent: InvestigationFacts["recent"] = [];
  if (hasPermission(env.ctx, "audit", "view") && ids.length) {
    const a = await read<{ occurred_at: string; action: string; actor_type: string; users: { display_name: string | null; full_name: string | null } | null }[]>(gaps, "Recent history",
      db.from("audit_log").select("occurred_at, action, actor_type, users(display_name, full_name)").eq("organization_id", org).in("object_id", ids.slice(0, 40)).order("occurred_at", { ascending: false }).limit(10));
    recent = (a ?? []).filter((x) => !/^(conversation|work_item\.step_by_run)/.test(x.action)).map((x) => ({ at: x.occurred_at, action: x.action, actor: x.actor_type === "user" ? (x.users?.display_name ?? x.users?.full_name ?? "A colleague") : "ASAP" }));
  }
  return { client: c.data as { id: string; name: string }, work: work ?? [], counts: { openWork, policies, inForce }, periods, claims: claims ?? [], arrivals, recent, unavailable: gaps };
}

const block = (id: string, component: LivingComponent, role: LivingBlock["role"], title: string | null, props: Record<string, unknown>, actions: LivingBlock["actions"] = []): LivingBlock =>
  ({ id, component, version: LIVING_REGISTRY[component].version, role, title, props, evidence: [], actions, hash: hash([props, actions]) });

const statusOf = (w: Work) => (w.task_status === "with_party" && w.task_party ? `With ${w.task_party}${w.task_since ? ` since ${fmt(w.task_since)}` : ""}` : w.task_status === "needs_you" ? "Needs someone at the brokerage" : "In progress");
const LIVING_KINDS = new Set(["renewal", "claim", "endorsement"]);

export function composeInvestigation(f: InvestigationFacts, opts: { now: Date; aiAvailable: boolean }): LivingSurface {
  const now = opts.now.getTime();
  const live = (p: Period) => new Date(`${p.period_start}T00:00:00Z`).getTime() <= now && new Date(`${p.period_end}T23:59:59Z`).getTime() >= now;
  const n = (v: number | null) => (v === null ? "Could not be counted" : String(v));
  const needsYou = f.work.filter((w) => w.task_status === "needs_you").length;
  const openClaims = f.claims.filter((c) => !["closed", "withdrawn", "settled"].includes(c.status)).length;
  const blocks: LivingBlock[] = [];

  blocks.push(block("header", "ContextHeader", "lead", null, {
    eyebrow: "Client",
    title: cut(f.client.name, 200),
    client: { id: f.client.id, name: cut(f.client.name, 200) },
    facts: [
      { label: "Open work", value: n(f.counts.openWork) },
      { label: "Policies in force", value: f.counts.inForce === null || f.counts.policies === null ? "Could not be counted" : `${f.counts.inForce} of ${f.counts.policies} on file` },
      { label: "Claims open", value: String(openClaims) },
    ],
    // Counted over the most recent open work loaded; said as "at least" when there is more.
    status: needsYou ? { label: `${f.counts.openWork !== null && f.counts.openWork > f.work.length ? "At least " : ""}${needsYou} need${needsYou === 1 ? "s" : ""} someone`, tone: "gold" } : f.counts.openWork !== null && f.counts.openWork > f.work.length ? { label: "Open work to look through", tone: "grey" } : { label: "Nothing waiting on the brokerage", tone: "green" },
    owner: null,
  }, [{ kind: "open", label: "Open the client record", ref: { ws: "client", clientId: f.client.id }, primary: false }]));

  // The most pressing first: waiting on the brokerage, then by due date, then most recently changed.
  const pressing = [...f.work].sort((a, b) => Number(b.task_status === "needs_you") - Number(a.task_status === "needs_you") || (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"));
  const total = f.counts.openWork ?? pressing.length;
  if (pressing.length)
    blocks.push(block("work", "RelatedWork", "main", total > 8 ? `Open work — the 8 most pressing${total > pressing.length ? ` of the ${pressing.length} most recently changed (${total} open)` : ` of ${total}`}` : "Open work", {
      items: pressing.slice(0, 8).map((w) => ({
        title: cut(w.title, 200), kind: KIND[w.kind] ?? "Work", status: cut(statusOf(w), 500),
        why: cut(w.required_action ?? (w.due_on ? `Due ${fmt(w.due_on)}` : "No next step is recorded on it."), 500), certainty: "none" as const,
        ref: LIVING_KINDS.has(w.kind) ? { ws: "living", workItemId: w.id } : { ws: "workitem", workItemId: w.id },
      })),
    }));
  else blocks.push(block("work", "WorkChecklist", "main", "Open work", { items: [], note: "No open work for this client." }));

  // Looking across a client proposes nothing: each email's own workspace offers its step.
  const arrived = arrivedMailBlock({ arrivals: f.arrivals, canRecordResponse: false });
  if (arrived) {
    const items = (arrived.props as { items: { proposed: string }[] }).items.map((i) => ({ ...i, proposed: "Open the work it was filed to: its workspace offers the step that deals with it." }));
    blocks.push({ ...arrived, props: { ...arrived.props, items }, hash: hash(items) });
  }

  if (f.periods.length)
    blocks.push(block("cover", "WorkChecklist", "main", f.counts.policies !== null && f.counts.policies > f.periods.length ? `Cover on file — ending soonest (${f.periods.length} shown of ${f.counts.policies} policies)` : "Cover on file — ending soonest", {
      items: f.periods.map((p, i) => {
        const on = live(p);
        const ended = new Date(`${p.period_end}T23:59:59Z`).getTime() < now;
        const soon = on && new Date(`${p.period_end}T23:59:59Z`).getTime() - now < 60 * DAY;
        return {
          key: `${p.policies.id}:${i}`,
          label: cut(`${p.policies.class_of_business}${p.policies.policy_number ? ` ${p.policies.policy_number}` : ""} — ${p.policies.insurers?.name ?? "insurer not recorded"}`, 200),
          detail: cut(`${fmt(p.period_start)} – ${fmt(p.period_end)}${soon ? " · ends within 60 days" : ""}`, 500),
          state: on ? (soon ? "outstanding" as const : "done" as const) : "pending" as const,
          party: on ? null : ended ? "Ended in the last 60 days" : "Not started yet",
          since: null,
        };
      }),
      note: "Periods as recorded on each policy, ending soonest first. A period on file is not proof of payment or of a current schedule.",
    }));

  if (f.claims.length)
    blocks.push(block("claims", "Timeline", "side", "Claims", {
      events: f.claims.slice(0, 10).map((c) => ({ at: c.incident_on ?? new Date(now).toISOString().slice(0, 10), text: cut(`${c.incident_summary ?? "Claim"} — ${c.status.replace(/_/g, " ")}${c.insurer_reference ? ` · ${c.insurer_reference}` : ""}`, 500), actor: c.policies?.policy_number ?? null })),
    }));

  if (f.recent.length)
    blocks.push(block("recent", "Timeline", "side", "Recent changes", {
      events: f.recent.map((e) => ({ at: e.at, text: cut(e.action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ").replace(/^./, (x) => x.toUpperCase()), 500), actor: e.actor })),
    }));

  return {
    version: 1,
    surfaceId: `investigation:${f.client.id}`,
    purpose: "investigation",
    subject: { kind: "client", id: f.client.id, title: cut(f.client.name, 200) },
    stage: null,
    generatedAt: opts.now.toISOString(),
    fingerprint: hash([blocks.map((b) => [b.id, b.hash]), f.unavailable]),
    blocks,
    ai: { available: opts.aiAvailable },
    unavailable: f.unavailable.slice(0, 12),
  };
}

/** Which client a request names, from the brokerage's own client names (under RLS). Never a guess. */
export async function resolveClient(env: Env, text: string): Promise<{ clientId: string | null; unclear: string | null; candidates: { id: string; name: string }[] }> {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !["everything", "about", "for", "with", "the", "what", "whats", "going", "look", "into", "investigate", "client", "show", "all", "open", "work", "happening", "and", "limited", "ltd"].includes(w));
  if (!words.length) return { clientId: null, unclear: "Say which client to look across.", candidates: [] };
  const r = await env.db.from("clients").select("id, name").eq("organization_id", env.organizationId).is("deleted_at", null).or(words.slice(0, 4).map((w) => `name.ilike.%${w}%`).join(",")).limit(20);
  if (r.error) throw mapDatabaseError(r.error);
  const rows = (r.data ?? []) as { id: string; name: string }[];
  // Chosen only when one client's name carries every distinctive word asked; partial matches are
  // offered as choices, never picked.
  const scored = rows.map((c) => ({ ...c, score: words.filter((w) => c.name.toLowerCase().includes(w)).length })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const full = scored.filter((c) => c.score === words.length);
  if (full.length === 1) return { clientId: full[0]!.id, unclear: null, candidates: [] };
  if (full.length > 1) return { clientId: null, unclear: "More than one client matches. Which one?", candidates: full.slice(0, 5).map((c) => ({ id: c.id, name: cut(c.name, 200) })) };
  if (!scored.length) return { clientId: null, unclear: "No client of this brokerage has that name.", candidates: [] };
  return { clientId: null, unclear: "No client matches all of that. Did you mean one of these?", candidates: scored.slice(0, 5).map((c) => ({ id: c.id, name: cut(c.name, 200) })) };
}
