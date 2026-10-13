import type { HomeChangesResponse } from "@asap/schema";
import { mapDatabaseError } from "../errors.js";
import type { Env } from "../placement/service.js";

/**
 * What changed since this person last looked (D-159): the brokerage's semantic events (§29),
 * read under the viewer's session, phrased in plain words and linked to the work they happened to.
 *
 * Nothing here is a value: a line says that an insurer answered, never what they quoted — the
 * figure is on the record the line opens. A person's own actions are not news to them. Repeated
 * events on the same work are one line. "Since you last looked" is the start of the current visit,
 * kept stable for half an hour so a refresh does not empty it.
 */

type Phrase = { text: string; tone: "green" | "gold" | "red" | "grey" };
const PHRASES: Record<string, Phrase> = {
  "quote.received": { text: "Insurer terms received", tone: "green" },
  "client.instruction_recorded": { text: "The client's instruction was recorded", tone: "green" },
  "cover.confirmed": { text: "The insurer confirmed cover in writing", tone: "green" },
  "policy.issued": { text: "The issued policy was checked and applied", tone: "green" },
  "run.could_not_finish": { text: "ASAP stopped and needs a person", tone: "red" },
  "claim.reported": { text: "A claim was reported", tone: "gold" },
  "claim.registered": { text: "A claim was registered with the insurer", tone: "green" },
  "endorsement.requested": { text: "A policy change was requested", tone: "gold" },
  "document.received": { text: "A document arrived", tone: "gold" },
};
/** Quotation steps worth telling someone about, by the action recorded on `opportunity.changed`. */
const QUOTATION: Record<string, Phrase> = {
  record_response: { text: "An insurer's answer was recorded", tone: "green" },
  record_delivery: { text: "A request was delivered to an insurer", tone: "grey" },
  approve_request: { text: "An insurer request was approved", tone: "grey" },
  present_comparison: { text: "The comparison was presented to the client", tone: "green" },
  close: { text: "The quotation was closed", tone: "grey" },
};
const VISIT_MS = 30 * 60_000;

export async function homeChanges(env: Env, now: Date): Promise<HomeChangesResponse> {
  const { db, organizationId: org, userId } = env;
  const pr = await db.from("surface_preferences").select("prefs").eq("organization_id", org).eq("user_id", userId).eq("surface_key", "home").maybeSingle();
  if (pr.error) throw mapDatabaseError(pr.error);
  const stored = (pr.data?.prefs ?? {}) as { lastSeenAt?: string | null; previousSeenAt?: string | null; pinned?: string[]; collapsed?: string[]; selection?: Record<string, string> };
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const last = stored.lastSeenAt ?? null;
  const newVisit = !last || now.getTime() - new Date(last).getTime() > VISIT_MS;
  const since = newVisit ? last ?? week : stored.previousSeenAt ?? last ?? week;
  const next = { pinned: stored.pinned ?? [], collapsed: stored.collapsed ?? [], selection: stored.selection ?? {}, lastSeenAt: now.toISOString(), previousSeenAt: since };
  const up = await db.from("surface_preferences").upsert({ organization_id: org, user_id: userId, surface_key: "home", prefs: next, updated_at: now.toISOString() }, { onConflict: "organization_id,user_id,surface_key" });
  if (up.error) throw mapDatabaseError(up.error);

  const types = [...Object.keys(PHRASES), "opportunity.changed"];
  const ev = await db
    .from("events")
    .select("id, event_type, entity_type, entity_id, actor, actor_user_id, payload, occurred_at")
    .eq("organization_id", org)
    .in("event_type", types)
    .gt("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(300);
  if (ev.error) throw mapDatabaseError(ev.error);
  type Row = { id: string; event_type: string; entity_type: string | null; entity_id: string | null; actor: string; actor_user_id: string | null; payload: Record<string, unknown>; occurred_at: string };
  const rows = ((ev.data ?? []) as Row[]).filter((r) => r.actor_user_id !== userId);

  const items = new Map<string, { key: string; at: string; phrase: Phrase; workItemId: string | null; documentId: string | null; actorUserId: string | null; actor: string; count: number }>();
  for (const r of rows) {
    const phrase = r.event_type === "opportunity.changed" ? QUOTATION[String(r.payload["action"] ?? "")] : PHRASES[r.event_type];
    if (!phrase) continue;
    const workItemId = typeof r.payload["workItemId"] === "string" ? (r.payload["workItemId"] as string) : null;
    const documentId = r.entity_type === "document" ? r.entity_id : null;
    const key = `${phrase.text}|${workItemId ?? documentId ?? r.id}`;
    const seen = items.get(key);
    if (seen) seen.count += 1;
    else items.set(key, { key, at: r.occurred_at, phrase, workItemId, documentId, actorUserId: r.actor_user_id, actor: r.actor, count: 1 });
  }
  const list = [...items.values()];
  // Titles and kinds come from the work items themselves, under RLS: what the viewer cannot read is left out.
  const wids = [...new Set(list.map((x) => x.workItemId).filter((x): x is string => !!x))];
  const wi = wids.length ? await db.from("work_items").select("id, title, kind").eq("organization_id", org).in("id", wids).is("deleted_at", null) : { data: [], error: null };
  if (wi.error) throw mapDatabaseError(wi.error);
  const works = new Map(((wi.data ?? []) as { id: string; title: string; kind: string }[]).map((w) => [w.id, w]));
  const uids = [...new Set(list.map((x) => x.actorUserId).filter((x): x is string => !!x))];
  const us = uids.length ? await db.from("users").select("id, display_name, full_name").in("id", uids) : { data: [], error: null };
  const names = new Map(((us.data ?? []) as { id: string; display_name: string | null; full_name: string | null }[]).map((u) => [u.id, u.display_name ?? u.full_name ?? "A colleague"]));

  const visible = list.filter((x) => !x.workItemId || works.has(x.workItemId));
  const changes = visible.slice(0, 20).map((x) => {
    const w = x.workItemId ? works.get(x.workItemId)! : null;
    const ref = w ? (w.kind === "renewal" ? { ws: "living", workItemId: w.id } : { ws: "workitem", workItemId: w.id }) : x.documentId ? { ws: "document", documentId: x.documentId } : null;
    return {
      key: x.key.slice(0, 200), at: x.at, tone: x.phrase.tone, text: x.phrase.text, subject: w ? w.title.slice(0, 200) : null,
      actor: x.actorUserId ? names.get(x.actorUserId) ?? "A colleague" : x.actor === "automation" || x.actor === "system" ? "ASAP" : x.actor === "ai" ? "ASAP" : null,
      count: x.count, ref,
    };
  });
  return { since, changes, more: Math.max(0, visible.length - 20) };
}
