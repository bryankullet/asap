/**
 * The address is the open surface (D-155). Every surface has one, so refresh reopens it and Back
 * and Forward move between surfaces like any other site.
 *
 *   /                          Home
 *   /work?view=needs_me        Work, full width
 *   /automations               Automations, full width
 *   /activity                  Activity, full width
 *   /ask                       a new conversation, centred (named on its first message)
 *   /ask/<id>                  a named conversation, centred
 *   /ask/<id>?space=<ref>      the conversation beside the Space it opened (split)
 *   /s/<ws>?<ref fields>       a Space, full width
 *   /s/<ws>?…&ask=<id|new>     the Space with its contextual conversation drawer
 *   /s/<ws>?…&back=<id>        on a phone, the Space opened from a conversation, with the way back
 */
export type Ref = Record<string, unknown> & { ws: string };

export type Surface =
  | { mode: "home" }
  | { mode: "work"; view: string }
  | { mode: "automations" }
  | { mode: "activity"; filter: Record<string, string> }
  | { mode: "conversation"; conversationId: string | null; space: Ref | null }
  | { mode: "space"; ref: Ref; drawer: string | null; back?: string | null };

const RESERVED = new Set(["ask", "space", "back"]);
const enc = (v: unknown) => (typeof v === "string" ? v : `j:${JSON.stringify(v)}`);
const dec = (v: string): unknown => {
  if (!v.startsWith("j:")) return v;
  try {
    return JSON.parse(v.slice(2));
  } catch {
    return v;
  }
};

export function refToQuery(ref: Ref, params = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(ref)) {
    if (k === "ws" || v == null || v === "" || RESERVED.has(k)) continue;
    params.set(k, enc(v));
  }
  return params;
}

export function queryToRef(ws: string, params: URLSearchParams): Ref {
  const ref: Ref = { ws };
  for (const [k, v] of params) if (!RESERVED.has(k)) ref[k] = dec(v);
  return ref;
}

/** A ref packed into one query value, for the Space beside a conversation. */
export const packRef = (ref: Ref) => `${ref.ws}${refToQuery(ref).toString() ? `?${refToQuery(ref).toString()}` : ""}`;
export function unpackRef(v: string | null): Ref | null {
  if (!v) return null;
  const [ws, q] = v.split("?");
  if (!ws || !/^[a-z][a-z0-9_]{0,39}$/.test(ws)) return null;
  return queryToRef(ws, new URLSearchParams(q ?? ""));
}

/** The full-width surfaces that are not Spaces: a ref to one of them opens the surface itself. */
const SURFACE_WS: Record<string, Surface> = {
  today: { mode: "home" },
  home: { mode: "home" },
  work: { mode: "work", view: "needs_me" },
  activity: { mode: "activity", filter: {} },
};

export function parse(pathname: string, search: string): Surface {
  const params = new URLSearchParams(search);
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { mode: "home" };
  const [head, second] = parts;
  if (head === "work") return { mode: "work", view: params.get("view") ?? "needs_me" };
  if (head === "automations" && !second) return { mode: "automations" };
  if (head === "automations" && second) return { mode: "space", ref: { ws: "automation", automationId: second }, drawer: params.get("ask") };
  if (head === "activity") return { mode: "activity", filter: Object.fromEntries(params) };
  if (head === "ask") return { mode: "conversation", conversationId: second ?? null, space: unpackRef(params.get("space")) };
  if (head === "s" && second) return params.get("back") ? { mode: "space", ref: queryToRef(second, params), drawer: params.get("ask"), back: params.get("back") } : { mode: "space", ref: queryToRef(second, params), drawer: params.get("ask") };
  // Older addresses (/today, /clients/…) open Home rather than a dead page.
  return { mode: "home" };
}

export function toPath(s: Surface): string {
  switch (s.mode) {
    case "home":
      return "/";
    case "work":
      return s.view && s.view !== "needs_me" ? `/work?view=${encodeURIComponent(s.view)}` : "/work";
    case "automations":
      return "/automations";
    case "activity": {
      const q = new URLSearchParams(s.filter).toString();
      return q ? `/activity?${q}` : "/activity";
    }
    case "conversation": {
      const base = s.conversationId ? `/ask/${s.conversationId}` : "/ask";
      return s.space ? `${base}?space=${encodeURIComponent(packRef(s.space))}` : base;
    }
    case "space": {
      if (s.ref.ws === "automation" && typeof s.ref["automationId"] === "string" && Object.keys(s.ref).length === 2)
        return `/automations/${s.ref["automationId"]}${s.drawer ? `?ask=${encodeURIComponent(s.drawer)}` : ""}`;
      const q = refToQuery(s.ref);
      if (s.drawer) q.set("ask", s.drawer);
      if (s.back) q.set("back", s.back);
      const qs = q.toString();
      return `/s/${s.ref.ws}${qs ? `?${qs}` : ""}`;
    }
  }
}

/** Where a ref opens on its own: Home, Work and Activity are surfaces; everything else is a Space. */
export function surfaceForRef(ref: Ref): Surface {
  const fixed = SURFACE_WS[ref.ws];
  if (fixed) return fixed;
  if (ref.ws === "automation" && !ref["automationId"]) return { mode: "automations" };
  return { mode: "space", ref, drawer: null };
}

/** The same record, whatever was typed into it — so opening it twice focuses it, not a duplicate. */
export function sameRef(a: Ref | null, b: Ref | null): boolean {
  if (!a || !b) return a === b;
  const id = (r: Ref) =>
    JSON.stringify(
      Object.keys(r)
        .filter((k) => !["query", "date", "view"].includes(k) && r[k] != null && r[k] !== "")
        .sort()
        .map((k) => [k, r[k]]),
    );
  return id(a) === id(b);
}
