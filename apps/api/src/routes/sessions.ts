import {
  CONVERSATION_STATUS_LABEL,
  conversationPurpose,
  conversationSummarySchema,
  deriveConversationStatus,
  deriveConversationTitle,
  kindOfRef,
  recentItemSchema,
  recordOpenRequestSchema,
  refKey,
  startConversationRequestSchema,
  updateConversationRequestSchema,
  type ConversationPurpose,
  type ConversationSummary,
  type RecentItem,
  type SurfaceRef,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";

/**
 * Named work sessions, Recent and Pins (D-155) — what the adaptive shell reopens work through.
 *
 * Everything here is personal and tenant-scoped twice: RLS on every table (0032, 0078), and the
 * active organization resolved from the session on every request. Nothing is a business fact: a
 * session's status is derived from the Work item it is linked to, and every title shown for a
 * record is re-read from that record.
 */

const COLUMNS = "id, title, title_source, purpose, scope_kind, scope_id, work_item_id, space_ref, created_at, updated_at, last_activity_at";
type Row = {
  id: string; title: string; title_source: "question" | "derived" | "person"; purpose: ConversationPurpose; scope_kind: string; scope_id: string | null;
  work_item_id: string | null; space_ref: SurfaceRef | null; created_at: string; updated_at: string; last_activity_at: string;
};
type WorkFacts = { id: string; title: string; kind: string; task_status: string; exception: unknown; completed_at: string | null; client_id: string | null; policy_period_id: string | null };

/** The linked facts for a set of sessions: work items, their live runs, clients, policy numbers, claim references, turn counts. */
async function linkedFacts(db: SupabaseClient, orgId: string, rows: Row[]) {
  const workIds = [...new Set(rows.map((r) => r.work_item_id).filter((x): x is string => !!x))];
  const work = new Map<string, WorkFacts>();
  const runs = new Map<string, { id: string; state: string }>();
  const claimRefs = new Map<string, string>();
  const policyNumbers = new Map<string, string>();
  if (workIds.length) {
    const [w, r, cl] = await Promise.all([
      db.from("work_items").select("id, title, kind, task_status, exception, completed_at, client_id, policy_period_id").eq("organization_id", orgId).in("id", workIds),
      db.from("workflow_runs").select("id, work_item_id, state, created_at").eq("organization_id", orgId).in("work_item_id", workIds).order("created_at", { ascending: false }),
      db.from("claims").select("work_item_id, insurer_reference").eq("organization_id", orgId).in("work_item_id", workIds),
    ]);
    if (w.error) throw mapDatabaseError(w.error);
    for (const x of (w.data ?? []) as WorkFacts[]) work.set(x.id, x);
    for (const x of (r.data ?? []) as { id: string; work_item_id: string; state: string }[]) if (!runs.has(x.work_item_id)) runs.set(x.work_item_id, { id: x.id, state: x.state });
    for (const x of (cl.data ?? []) as { work_item_id: string; insurer_reference: string | null }[]) if (x.insurer_reference) claimRefs.set(x.work_item_id, x.insurer_reference);
    const periods = [...new Set([...work.values()].map((x) => x.policy_period_id).filter((x): x is string => !!x))];
    if (periods.length) {
      const p = await db.from("policy_periods").select("id, policies(policy_number)").eq("organization_id", orgId).in("id", periods);
      for (const x of (p.data ?? []) as unknown as { id: string; policies: { policy_number: string | null } | null }[]) if (x.policies?.policy_number) policyNumbers.set(x.id, x.policies.policy_number);
    }
  }
  const clientIds = new Set<string>();
  for (const r of rows) if (r.scope_kind === "client" && r.scope_id) clientIds.add(r.scope_id);
  for (const w of work.values()) if (w.client_id) clientIds.add(w.client_id);
  const clients = new Map<string, string>();
  if (clientIds.size) {
    const c = await db.from("clients").select("id, name").eq("organization_id", orgId).in("id", [...clientIds]);
    for (const x of (c.data ?? []) as { id: string; name: string }[]) clients.set(x.id, x.name);
  }
  const turns = new Map<string, number>();
  if (rows.length) {
    const m = await db.from("conversation_messages").select("conversation_id").eq("organization_id", orgId).in("conversation_id", rows.map((r) => r.id));
    for (const x of (m.data ?? []) as { conversation_id: string }[]) turns.set(x.conversation_id, (turns.get(x.conversation_id) ?? 0) + 1);
  }
  return { work, runs, claimRefs, policyNumbers, clients, turns };
}

function summarize(r: Row, f: Awaited<ReturnType<typeof linkedFacts>>): ConversationSummary & { searchText: string } {
  const w = r.work_item_id ? f.work.get(r.work_item_id) ?? null : null;
  const run = w ? f.runs.get(w.id) ?? null : null;
  const clientId = w?.client_id ?? (r.scope_kind === "client" ? r.scope_id : null);
  const clientName = clientId ? f.clients.get(clientId) ?? null : null;
  const status = deriveConversationStatus({
    turns: f.turns.get(r.id) ?? 0,
    workItem: w ? { taskStatus: w.task_status, exception: !!w.exception, completed: !!w.completed_at } : null,
    runState: run?.state ?? null,
  });
  return {
    id: r.id,
    title: r.title,
    titleSource: r.title_source,
    purpose: r.purpose,
    status,
    statusLabel: CONVERSATION_STATUS_LABEL[status],
    client: clientId && clientName ? { id: clientId, name: clientName } : null,
    workItem: w ? { id: w.id, title: w.title, kind: w.kind } : null,
    runId: run?.id ?? null,
    spaceRef: r.space_ref,
    scope: { kind: r.scope_kind, id: r.scope_id },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at,
    // What Search matches: the title, the client, the workflow, the policy number and claim reference.
    searchText: [r.title, clientName, w?.title, w?.policy_period_id ? f.policyNumbers.get(w.policy_period_id) : null, w ? f.claimRefs.get(w.id) : null, r.purpose].filter(Boolean).join(" \u0001 ").toLowerCase(),
  };
}

const strip = ({ searchText: _s, ...rest }: ConversationSummary & { searchText: string }) => conversationSummarySchema.parse(rest);

/** The client a request names, from this brokerage's own clients: the longest name whose first word appears. */
async function clientNamedIn(db: SupabaseClient, orgId: string, text: string): Promise<{ id: string; name: string } | null> {
  const words = new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3));
  if (!words.size) return null;
  const c = await db.from("clients").select("id, name").eq("organization_id", orgId).is("deleted_at", null).limit(2000);
  const hits = ((c.data ?? []) as { id: string; name: string }[]).filter((x) => {
    const first = x.name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/)[0] ?? "";
    return first.length >= 3 && words.has(first);
  });
  return hits.length === 1 ? hits[0]! : null;
}

async function insurersNamedIn(db: SupabaseClient, orgId: string, text: string): Promise<string[]> {
  const t = text.toLowerCase();
  const i = await db.from("insurers").select("name").eq("organization_id", orgId).limit(500);
  return ((i.data ?? []) as { name: string }[])
    .map((x) => x.name)
    .filter((n) => {
      const first = n.toLowerCase().split(/\s+/)[0] ?? "";
      return first.length >= 3 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, "")}\\b`).test(t);
    })
    .sort((a, b) => t.indexOf(a.toLowerCase().split(/\s+/)[0]!) - t.indexOf(b.toLowerCase().split(/\s+/)[0]!));
}

/** A record's current label, re-read from the record; null when it is gone or not readable. */
async function labelsFor(db: SupabaseClient, orgId: string, items: { ref: SurfaceRef | null; conversation_id: string | null }[]) {
  const ids = (key: string) => [...new Set(items.map((x) => x.ref?.[key]).filter((v): v is string => typeof v === "string"))];
  const out = new Map<string, string | null>();
  const load = async (table: string, key: string, col: string, idCol = "id") => {
    const list = ids(key);
    if (!list.length) return;
    const r = await db.from(table).select(`${idCol}, ${col}`).eq("organization_id", orgId).in(idCol, list);
    const found = new Map(((r.data ?? []) as unknown as Record<string, string>[]).map((x) => [x[idCol]!, x[col]!]));
    for (const id of list) out.set(`${key}:${id}`, found.get(id) ?? null);
  };
  await Promise.all([
    load("clients", "clientId", "name"),
    load("work_items", "workItemId", "title"),
    load("automations", "automationId", "name"),
    load("opportunities", "opportunityId", "title"),
  ]);
  const convIds = [...new Set(items.map((x) => x.conversation_id).filter((v): v is string => !!v))];
  if (convIds.length) {
    const c = await db.from("conversations").select("id, title").eq("organization_id", orgId).in("id", convIds).is("deleted_at", null);
    const found = new Map(((c.data ?? []) as { id: string; title: string }[]).map((x) => [x.id, x.title]));
    for (const id of convIds) out.set(`conversation:${id}`, found.get(id) ?? null);
  }
  return out;
}

function currentTitle(labels: Map<string, string | null>, x: { ref: SurfaceRef | null; conversation_id: string | null; title: string }): string | null {
  if (x.conversation_id) return labels.get(`conversation:${x.conversation_id}`) ?? null;
  for (const key of ["workItemId", "automationId", "opportunityId", "clientId"]) {
    const id = x.ref?.[key];
    if (typeof id === "string" && labels.has(`${key}:${id}`)) {
      const l = labels.get(`${key}:${id}`);
      // Only the record the surface IS about decides; a client named as context on a workflow does not.
      if (key === "clientId" && x.ref?.["ws"] !== "client") continue;
      return l ?? null;
    }
  }
  return x.title;
}

export function sessionRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  async function org(c: { get(k: "auth"): { db: SupabaseClient; user: { id: string } } }) {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    return { db, user, org: requireActiveOrganization(ctx) };
  }

  async function loadOne(db: SupabaseClient, orgId: string, userId: string, id: string): Promise<Row> {
    const r = await db.from("conversations").select(COLUMNS).eq("organization_id", orgId).eq("created_by", userId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (r.error) throw mapDatabaseError(r.error);
    if (!r.data) throw new HttpError(404, "not_found", "That conversation is not available.");
    return r.data as Row;
  }

  /** The person's sessions, newest activity first; `q` matches title, client, workflow, policy number and claim reference. */
  app.get("/sessions", async (c) => {
    const { db, user, org: o } = await org(c);
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const r = await db.from("conversations").select(COLUMNS).eq("organization_id", o.id).eq("created_by", user.id).is("deleted_at", null).order("last_activity_at", { ascending: false }).limit(q ? 300 : 50);
    if (r.error) throw mapDatabaseError(r.error);
    const rows = (r.data ?? []) as Row[];
    const facts = await linkedFacts(db, o.id, rows);
    let list = rows.map((x) => summarize(x, facts));
    if (q) list = list.filter((x) => q.split(/\s+/).every((w) => x.searchText.includes(w)));
    return c.json({ conversations: list.slice(0, 50).map(strip) });
  });

  app.get("/sessions/:id", async (c) => {
    const { db, user, org: o } = await org(c);
    const row = await loadOne(db, o.id, user.id, c.req.param("id"));
    return c.json({ conversation: strip(summarize(row, await linkedFacts(db, o.id, [row]))) });
  });

  /**
   * Start a named session — or reopen the one already about the same work. Two requests about the
   * same Work item, or the same purpose for the same client while that session is unfinished, open
   * one session, not two.
   */
  app.post("/sessions", async (c) => {
    const { db, user, org: o } = await org(c);
    const parsed = startConversationRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "Say what you would like ASAP to handle.");
    const input = parsed.data;
    const purpose = input.purpose ?? conversationPurpose(input.text);

    // The scope is an id the caller can already read; an explicit client named in the request wins.
    let client: { id: string; name: string } | null = null;
    const named = await clientNamedIn(db, o.id, input.text);
    if (named) client = named;
    else if (input.scope.kind === "client" && input.scope.id) {
      const r = await db.from("clients").select("id, name").eq("organization_id", o.id).eq("id", input.scope.id).maybeSingle();
      client = (r.data as { id: string; name: string } | null) ?? null;
      if (!client) throw new HttpError(404, "not_found", "That client is not available.");
    }
    let workItemId = input.workItemId;
    if (workItemId) {
      const w = await db.from("work_items").select("id, client_id").eq("organization_id", o.id).eq("id", workItemId).is("deleted_at", null).maybeSingle();
      if (!w.data) throw new HttpError(404, "not_found", "That work is not available.");
      // An explicit client in the request overrides inherited context; a Work item's own client does not override it.
      if (!client && (w.data as { client_id: string | null }).client_id) {
        const r = await db.from("clients").select("id, name").eq("organization_id", o.id).eq("id", (w.data as { client_id: string }).client_id).maybeSingle();
        client = (r.data as { id: string; name: string } | null) ?? null;
      }
      if (named && (w.data as { client_id: string | null }).client_id && (w.data as { client_id: string | null }).client_id !== named.id) workItemId = null;
    }

    const open = await db.from("conversations").select(COLUMNS).eq("organization_id", o.id).eq("created_by", user.id).is("deleted_at", null).order("last_activity_at", { ascending: false }).limit(100);
    if (open.error) throw mapDatabaseError(open.error);
    const candidates = (open.data ?? []) as Row[];
    const facts = await linkedFacts(db, o.id, candidates);
    const same = candidates.find((r) => {
      const s = summarize(r, facts);
      if (s.status === "completed") return false;
      if (workItemId) return r.work_item_id === workItemId;
      if (purpose === "question" || !client) return false;
      return r.purpose === purpose && (s.client?.id ?? null) === client.id;
    });
    if (same) {
      await db.from("conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", same.id);
      const fresh = await loadOne(db, o.id, user.id, same.id);
      return c.json({ conversation: strip(summarize(fresh, await linkedFacts(db, o.id, [fresh]))), reopened: true });
    }

    const title = deriveConversationTitle({
      text: input.text,
      purpose,
      clientName: client?.name ?? null,
      insurerNames: purpose === "comparison" ? await insurersNamedIn(db, o.id, input.text) : [],
      brokerageName: o.name,
    });
    const scope = client ? { scope_kind: "client", scope_id: client.id } : input.scope.kind !== "brokerage" && input.scope.id ? { scope_kind: input.scope.kind, scope_id: input.scope.id } : { scope_kind: "brokerage", scope_id: null };
    const ins = await db
      .from("conversations")
      .insert({ organization_id: o.id, created_by: user.id, title, title_source: "derived", purpose, ...scope, work_item_id: workItemId, space_ref: input.spaceRef })
      .select(COLUMNS)
      .single();
    if (ins.error) throw mapDatabaseError(ins.error);
    const row = ins.data as Row;
    deps.logger.info({ conversationId: row.id, purpose }, "a named session started");
    return c.json({ conversation: strip(summarize(row, await linkedFacts(db, o.id, [row]))), reopened: false }, 201);
  });

  /** Rename, or link to the Work item and Space it now controls. A person's title is never overwritten. */
  app.patch("/sessions/:id", async (c) => {
    const { db, user, org: o } = await org(c);
    const parsed = updateConversationRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", parsed.error.issues[0]?.message ?? "Nothing to change.");
    const row = await loadOne(db, o.id, user.id, c.req.param("id"));
    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) Object.assign(patch, { title: parsed.data.title, title_source: "person" });
    if (parsed.data.workItemId !== undefined) {
      if (parsed.data.workItemId) {
        const w = await db.from("work_items").select("id").eq("organization_id", o.id).eq("id", parsed.data.workItemId).maybeSingle();
        if (!w.data) throw new HttpError(404, "not_found", "That work is not available.");
      }
      patch["work_item_id"] = parsed.data.workItemId;
    }
    if (parsed.data.spaceRef !== undefined) patch["space_ref"] = parsed.data.spaceRef;
    const up = await db.from("conversations").update(patch).eq("id", row.id).eq("created_by", user.id).select(COLUMNS).single();
    if (up.error) throw mapDatabaseError(up.error);
    const fresh = up.data as Row;
    return c.json({ conversation: strip(summarize(fresh, await linkedFacts(db, o.id, [fresh]))) });
  });

  // ---------------------------------------------------------------- Recent and Pins

  async function list(db: SupabaseClient, orgId: string, userId: string, table: "recent_items" | "space_pins", limit: number): Promise<RecentItem[]> {
    const order = table === "recent_items" ? "opened_at" : "created_at";
    const r = await db.from(table).select(`ref_key, kind, ref, conversation_id, title, ${order}`).eq("organization_id", orgId).eq("user_id", userId).order(order, { ascending: false }).limit(limit * 2);
    if (r.error) throw mapDatabaseError(r.error);
    const rows = (r.data ?? []) as unknown as { ref_key: string; kind: RecentItem["kind"]; ref: SurfaceRef | null; conversation_id: string | null; title: string; opened_at?: string; created_at?: string }[];
    const labels = await labelsFor(db, orgId, rows);
    const pins = table === "recent_items" ? await db.from("space_pins").select("ref_key").eq("organization_id", orgId).eq("user_id", userId) : { data: rows.map((x) => ({ ref_key: x.ref_key })) };
    const pinned = new Set(((pins.data ?? []) as { ref_key: string }[]).map((x) => x.ref_key));
    const out: RecentItem[] = [];
    for (const x of rows) {
      const title = currentTitle(labels, x);
      // A record that is gone, or no longer readable, drops out of the list instead of naming nothing.
      if (title == null) continue;
      out.push(recentItemSchema.parse({ key: x.ref_key, kind: x.kind, ref: x.ref, conversationId: x.conversation_id, title, openedAt: (x.opened_at ?? x.created_at)!, pinned: pinned.has(x.ref_key) }));
      if (out.length >= limit) break;
    }
    return out;
  }

  async function entry(db: SupabaseClient, orgId: string, userId: string, body: unknown) {
    const parsed = recordOpenRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "validation_failed", "Say what was opened.");
    if ("conversationId" in parsed.data) {
      const row = await loadOne(db, orgId, userId, parsed.data.conversationId);
      return { ref_key: `conversation:${row.id}`, kind: "conversation", ref: null, conversation_id: row.id, title: row.title };
    }
    return { ref_key: refKey(parsed.data.ref), kind: kindOfRef(parsed.data.ref), ref: parsed.data.ref, conversation_id: null, title: parsed.data.title };
  }

  app.get("/recent", async (c) => {
    const { db, user, org: o } = await org(c);
    return c.json({ items: await list(db, o.id, user.id, "recent_items", Math.min(40, Number(c.req.query("limit") ?? 20) || 20)) });
  });

  /** Opened: the entry moves to the top, once — the same record opened twice is one entry. */
  app.post("/recent", async (c) => {
    const { db, user, org: o } = await org(c);
    const e = await entry(db, o.id, user.id, await c.req.json().catch(() => null));
    const up = await db.from("recent_items").upsert({ organization_id: o.id, user_id: user.id, ...e, opened_at: new Date().toISOString() }, { onConflict: "organization_id,user_id,ref_key" });
    if (up.error) throw mapDatabaseError(up.error);
    // Recent is short by design; older entries fall off rather than accumulate.
    const old = await db.from("recent_items").select("ref_key").eq("organization_id", o.id).eq("user_id", user.id).order("opened_at", { ascending: false }).range(60, 200);
    const keys = ((old.data ?? []) as { ref_key: string }[]).map((x) => x.ref_key);
    if (keys.length) await db.from("recent_items").delete().eq("organization_id", o.id).eq("user_id", user.id).in("ref_key", keys);
    return c.json({ key: e.ref_key });
  });

  app.get("/pins", async (c) => {
    const { db, user, org: o } = await org(c);
    return c.json({ items: await list(db, o.id, user.id, "space_pins", 30) });
  });

  app.put("/pins", async (c) => {
    const { db, user, org: o } = await org(c);
    const e = await entry(db, o.id, user.id, await c.req.json().catch(() => null));
    const up = await db.from("space_pins").upsert({ organization_id: o.id, user_id: user.id, ...e }, { onConflict: "organization_id,user_id,ref_key", ignoreDuplicates: true });
    if (up.error) throw mapDatabaseError(up.error);
    return c.json({ key: e.ref_key, pinned: true });
  });

  app.delete("/pins", async (c) => {
    const { db, user, org: o } = await org(c);
    const key = c.req.query("key");
    if (!key) throw new HttpError(400, "validation_failed", "Say which pin to remove.");
    const del = await db.from("space_pins").delete().eq("organization_id", o.id).eq("user_id", user.id).eq("ref_key", key);
    if (del.error) throw mapDatabaseError(del.error);
    return c.json({ key, pinned: false });
  });

  return app;
}
