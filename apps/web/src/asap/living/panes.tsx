import type { InvestigateResponse, LivingSurface as Surface, PortfolioQuery, PortfolioResponse, WorkspaceInterpretation } from "@asap/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "../shell/routes.js";
import type { LivingView, PrefsStore } from "../shell/types.js";
import { LivingSurface } from "./LivingSurface.js";

/** A Living workspace for one Work item — renewal, claim or policy change (D-156…D-165). */
export function LivingRenewalPane({ workItemId, runId, viewRef, living, interpret, prefsStore, onOpen, onAsk, onTitle }: {
  workItemId: string; runId: string | null; viewRef: Ref;
  living: (id: string, view?: LivingView) => Promise<Surface>;
  interpret?: ((id: string, text: string) => Promise<WorkspaceInterpretation>) | undefined;
  prefsStore?: PrefsStore | undefined;
  onOpen: (ref: Ref) => void; onAsk: (text: string) => void; onTitle: (t: string, purpose?: string) => void;
}) {
  // What to compose lives in the address (D-160, D-165): alternatives explored and a focus asked for.
  // Back undoes either; a link reproduces it.
  const str = (k: string) => (typeof viewRef[k] === "string" ? (viewRef[k] as string) : "");
  const explore = str("explore");
  const focus = str("focus");
  const target = str("target");
  const fq = str("fq");
  const fsrc = str("fsrc");
  const ids = useMemo(() => explore.split(",").filter(Boolean), [explore]);
  const load = useCallback(() => living(workItemId, { explore: ids, focus: focus || null, target: target || null, fq: fq || null, fsrc: fsrc || null }), [living, workItemId, ids, focus, target, fq, fsrc]);
  const base = useMemo(() => ({ ws: "living", workItemId, ...(runId ? { runId } : {}) }), [workItemId, runId]);
  const exploring = useMemo(() => ({
    ids,
    set: (next: string[]) => onOpen(next.length ? { ...base, explore: next.join(",") } : base),
  }), [ids, onOpen, base]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refine = useMemo(() => (interpret ? {
    busy,
    message,
    placeholder: "Ask about this — “compare the revised terms”, “what is blocking this?”",
    onRemove: () => onOpen(base),
    onRefine: async (text: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await interpret(workItemId, text);
        if (r.explore?.length) onOpen({ ...base, explore: r.explore.join(",") });
        else if (r.focus?.intent === "reset") onOpen(base);
        else if (r.focus) onOpen({ ...base, ...(explore ? { explore } : {}), focus: r.focus.intent, ...(r.focus.target ? { target: r.focus.target } : {}), fq: text.slice(0, 300), fsrc: r.source === "model" ? "model" : "rules" });
        else setMessage(r.unclear ?? "That could not be read. Nothing was changed.");
      } catch {
        setMessage("That could not be read just now. Nothing was changed.");
      } finally {
        setBusy(false);
      }
    },
  } : undefined), [interpret, busy, message, workItemId, base, explore, onOpen]);
  return <LivingSurface identity={`work:${workItemId}`} noun="work" runId={runId} load={load} prefsStore={prefsStore} explore={exploring} {...(refine ? { refine } : {})} onOpen={onOpen} onAsk={onAsk} onTitle={onTitle} />;
}

/** A request on Home that asks to look across one client's records (D-167). */
export function looksLikeInvestigation(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(prepare|start|create|send|approve|draft|email|write|call|remind|renew)\b/.test(t)) return false;
  return /\b(everything (about|on|for)|investigate|look into|look across|what'?s (going on|happening) with|all (the )?(open )?work (for|on))\b/.test(t);
}

/** A client investigation (D-167): resolved from words to a client by the server, then composed. */
export function InvestigationPane({ viewRef, investigation, resolveClient, prefsStore, onOpen, onNavigate, onAsk, onTitle }: {
  viewRef: Ref;
  investigation: (clientId: string) => Promise<Surface>;
  resolveClient?: ((text: string) => Promise<InvestigateResponse>) | undefined;
  prefsStore?: PrefsStore | undefined;
  onOpen: (ref: Ref) => void; onNavigate: (ref: Ref, replace: boolean) => void; onAsk: (text: string) => void; onTitle: (t: string) => void;
}) {
  const clientId = typeof viewRef["clientId"] === "string" ? (viewRef["clientId"] as string) : "";
  const text = typeof viewRef["t"] === "string" ? (viewRef["t"] as string) : "";
  const [answer, setAnswer] = useState<InvestigateResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (clientId || !text || !resolveClient) return;
    let live = true;
    resolveClient(text).then((r) => {
      if (!live) return;
      if (r.clientId) onNavigate({ ws: "investigation", clientId: r.clientId }, true);
      else setAnswer(r);
    }, () => live && setFailed(true));
    return () => { live = false; };
  }, [clientId, text, resolveClient, onNavigate]);
  const load = useCallback(() => investigation(clientId), [investigation, clientId]);
  if (clientId) return <LivingSurface key={clientId} identity={`client:${clientId}`} noun="client" load={load} prefsStore={prefsStore} onOpen={onOpen} onAsk={onAsk} onTitle={onTitle} />;
  return (
    <div className="lv-root">
      <div className="lv-scroll">
        <section className="lv-block lv-state" role="status">
          {failed ? <><h2>That could not be looked up just now</h2><p>Nothing is shown rather than a guess. Try again in a moment.</p></>
            : !answer ? <p>Finding the client…</p>
            : <>
                <h2>{answer.unclear ?? "Which client?"}</h2>
                <p>“{text}”</p>
                {answer.candidates.length ? (
                  <ul className="lv-candidates">
                    {answer.candidates.map((c) => <li key={c.id}><button type="button" className="lv-btn" onClick={() => onNavigate({ ws: "investigation", clientId: c.id }, false)}>{c.name}</button></li>)}
                  </ul>
                ) : null}
              </>}
        </section>
      </div>
    </div>
  );
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
