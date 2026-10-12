import type { LivingSurface as Surface, PortfolioQuery, PortfolioResponse } from "@asap/schema";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Ref } from "../shell/routes.js";
import type { PrefsStore } from "../shell/types.js";
import { LivingSurface } from "./LivingSurface.js";

/** The renewal workspace for one Work item (D-156/157). */
export function LivingRenewalPane({ workItemId, runId, explore, living, prefsStore, onOpen, onAsk, onTitle }: {
  workItemId: string; runId: string | null; explore: string; living: (id: string, explore?: string[]) => Promise<Surface>; prefsStore?: PrefsStore | undefined;
  onOpen: (ref: Ref) => void; onAsk: (text: string) => void; onTitle: (t: string, purpose?: string) => void;
}) {
  // Alternatives being explored live in the address (D-160): Back undoes an exploration, a link shares it.
  const ids = useMemo(() => explore.split(",").filter(Boolean), [explore]);
  const load = useCallback(() => living(workItemId, ids), [living, workItemId, ids]);
  const exploring = useMemo(() => ({
    ids,
    set: (next: string[]) => onOpen(next.length ? { ws: "living", workItemId, ...(runId ? { runId } : {}), explore: next.join(",") } : { ws: "living", workItemId, ...(runId ? { runId } : {}) }),
  }), [ids, onOpen, workItemId, runId]);
  return <LivingSurface identity={`work:${workItemId}`} noun="work" runId={runId} load={load} prefsStore={prefsStore} explore={exploring} onOpen={onOpen} onAsk={onAsk} onTitle={onTitle} />;
}

export type PortfolioApi = (body: { query: PortfolioQuery | null; text: string | null }) => Promise<PortfolioResponse>;

/**
 * Whether a request from Home is about the portfolio of renewals rather than one piece of work:
 * the plural, or the word portfolio, without an instruction to do something to one record.
 * Anything else goes to a conversation as before — this only decides where the request opens.
 */
export function looksLikePortfolio(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(renewals|portfolio)\b/.test(t)) return false;
  return !/\b(prepare|start|create|send|approve|draft|email|write|call|remind)\b/.test(t);
}

/** Reads the query an address carries; a malformed one is the default view, never an error page. */
export function queryOf(ref: Ref): PortfolioQuery | null {
  const raw = ref["q"];
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as PortfolioQuery;
  } catch {
    return null;
  }
}

/**
 * The renewal portfolio (D-158). The address carries the query (`/s/portfolio?q=…`), so refresh
 * reopens the same view and Back undoes a refinement. A request typed into the refine box — or
 * arriving from Home as `t` — is sent with the current query; the server returns the refined query
 * and the surface, and the address moves to the new query. The answer is reused for that address,
 * so moving there does not read twice, and what the interpreter did not understand stays visible.
 */
export function PortfolioPane({ viewRef, portfolio, prefsStore, onOpen, onNavigate, onTitle }: {
  viewRef: Ref; portfolio: PortfolioApi; prefsStore?: PrefsStore | undefined;
  onOpen: (ref: Ref) => void; onNavigate: (ref: Ref, replace: boolean) => void; onTitle: (t: string) => void;
}) {
  const qRaw = typeof viewRef["q"] === "string" ? (viewRef["q"] as string) : "";
  const query = useMemo(() => queryOf({ ws: "portfolio", q: qRaw }), [qRaw]);
  const entryText = typeof viewRef["t"] === "string" ? (viewRef["t"] as string) : null;
  // Each request is answered once; its answer is reused once, for the arrival at the new address.
  const [request, setRequest] = useState<{ text: string; n: number; fromEntry: boolean } | null>(entryText ? { text: entryText, n: 1, fromEntry: true } : null);
  const consumed = useRef(0);
  const answered = useRef<{ key: string; surface: Surface; unused: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const go = useCallback((q: PortfolioQuery, replace: boolean) => onNavigate({ ws: "portfolio", q: JSON.stringify(q) }, replace), [onNavigate]);

  const load = useCallback(async () => {
    const key = JSON.stringify(query);
    if (request && consumed.current !== request.n) {
      consumed.current = request.n;
      try {
        const r = await portfolio({ query, text: request.text });
        const nextKey = JSON.stringify(r.interpretation.query);
        answered.current = { key: nextKey, surface: r.surface, unused: true };
        // From Home the request replaces the entry address; a refinement is a step Back can undo.
        if (nextKey !== key || request.fromEntry) go(r.interpretation.query, request.fromEntry);
        return r.surface;
      } finally {
        setBusy(false);
      }
    }
    if (answered.current && answered.current.unused && answered.current.key === key) {
      answered.current.unused = false;
      return answered.current.surface;
    }
    return (await portfolio({ query, text: null })).surface;
  }, [query, request, portfolio, go]);

  const refine = useMemo(() => ({
    busy,
    placeholder: "Ask ASAP to change this view — “November, by insurer, only increases”",
    onRefine: (t: string) => { setBusy(true); setRequest((r) => ({ text: t, n: (r?.n ?? 0) + 1, fromEntry: false })); },
    onRemove: (field: string) => {
      const base = query ?? answeredQuery(answered.current);
      if (!base) return;
      const q = structuredClone(base);
      if (field === "groupBy") q.groupBy = null;
      else if (field === "compare") { q.compare = []; q.groupBy = null; }
      else if (field === "insurers") q.filters.insurers = [];
      else if (field === "classOfBusiness") q.filters.classOfBusiness = null;
      else if (field === "premiumChange") q.filters.premiumChange = null;
      else if (field === "status") q.filters.status = null;
      else if (field === "mine") q.filters.mine = false;
      go(q, false);
    },
  }), [busy, query, go]);

  return <LivingSurface identity="portfolio:renewals" noun="view" load={load} prefsStore={prefsStore} refine={refine} onOpen={onOpen} onAsk={() => {}} onTitle={onTitle} />;
}

/** The query of the view last answered, when the address had none yet (the default view). */
function answeredQuery(a: { key: string } | null): PortfolioQuery | null {
  if (!a) return null;
  try {
    return JSON.parse(a.key) as PortfolioQuery;
  } catch {
    return null;
  }
}
