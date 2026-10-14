import type { ASAPExperienceSpec, ExperienceResponse } from "@asap/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../app/router.js";
import { ApiError, api } from "../services/asap-api.js";
import { reconcile, RequestSequencer, type Reconciled } from "./composition/CompositionReconciler.js";
import { AskProvider, ExperienceProvider, useExperience, useExperienceAsk, useNarrow, useUi } from "./context/ExperienceContext.js";
import { ContinuityStore } from "./continuity/ContinuityStore.js";
import { dispatchAction, type DispatchExtra, type FormResult } from "./interactions/ActionDispatcher.js";
import { DocumentFrame } from "./components/working.js";
import { ExperienceRenderer } from "./renderer/ExperienceRenderer.js";

/**
 * Hosts one experience: loads it from the server (the session restores the person's state), renders
 * the validated composition, routes every interaction through the closed dispatcher, and keeps the
 * work current — polling while visible, re-reading on focus — without disturbing what the person is
 * doing: unchanged instances keep their state, an older response never replaces a newer one, and a
 * half-finished action that disappears is explained.
 */
const POLL_MS = 30_000;

export function ExperienceHost({ id, onTitle }: { id: string; onTitle: (t: string) => void }) {
  const narrow = useNarrow();
  const [view, setView] = useState<Reconciled | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [formResults, setFormResults] = useState<Record<string, FormResult>>({});
  const [doc, setDoc] = useState<{ id: string; title: string } | null>(null);
  const [withdrawnNotes, setWithdrawnNotes] = useState<string[]>([]);
  const seq = useRef(new RequestSequencer());
  const specRef = useRef<ASAPExperienceSpec | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const storeRef = useRef<ContinuityStore | null>(null);
  /** The action whose own result is being applied: it finished, so it is not "withdrawn". */
  const activeRef = useRef<string | null>(null);

  const apply = useCallback(
    (r: ExperienceResponse, ticket?: number) => {
      if (ticket !== undefined && !seq.current.accept(ticket)) return;
      if (r.redirect && r.redirect !== id) {
        navigate(`/x/${r.redirect}`);
        return;
      }
      const others = new Set([...pendingRef.current].filter((a) => a !== activeRef.current));
      const rec = reconcile(specRef.current, r.spec, others);
      if (rec.stale) return;
      specRef.current = rec.spec;
      if (!storeRef.current || storeRef.current.experienceId !== r.spec.experienceId) {
        storeRef.current?.dispose();
        storeRef.current = new ContinuityStore(r.spec.experienceId, r.ui, r.uiVersion, (base, ui) => api.saveUi(r.spec.experienceId, base, ui));
      } else storeRef.current.adopt(r.ui, r.uiVersion);
      if (rec.withdrawnPending.length) setWithdrawnNotes(rec.withdrawnPending.map((w) => w.reason));
      setView(rec);
      setError(null);
      onTitle(r.spec.title);
    },
    [id, onTitle],
  );

  const load = useCallback(async () => {
    const t = seq.current.ticket();
    try {
      apply(await api.experience(id), t);
    } catch (e) {
      if (!specRef.current || (e instanceof ApiError && (e.status === 404 || e.status === 403)))
        setError({ status: e instanceof ApiError ? e.status : 0, message: e instanceof ApiError ? (e.status === 404 ? "This work is not available — it may belong to another brokerage, or to someone else." : (e.userMessage ?? "This could not be opened.")) : "This could not be opened." });
    }
  }, [apply, id]);

  // Open (or reopen after Back/Forward): reset everything that belonged to the previous experience.
  useEffect(() => {
    specRef.current = null;
    setView(null);
    setError(null);
    setFormResults({});
    setWithdrawnNotes([]);
    setDoc(null);
    void load();
    return () => {
      void storeRef.current?.flush();
    };
  }, [id, load]);

  // Reactive: business state changes elsewhere (a quotation arrives, a colleague acts). Re-read on
  // focus and while visible; reconciliation keeps unaffected parts, and the person's input, as they were.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && pendingRef.current.size === 0) void load();
    };
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [load]);

  const deps = useMemo(
    () => ({
      experienceId: id,
      revision: () => specRef.current?.revision ?? 1,
      get store() {
        return storeRef.current!;
      },
      apply: (r: ExperienceResponse) => apply(r, seq.current.ticket()),
      navigate: (next: string) => navigate(`/x/${next}`),
      openDocument: (documentId: string, title: string) => setDoc({ id: documentId, title }),
      setFormResult: (instance: string, r: FormResult | null) =>
        setFormResults((m) => {
          const n = { ...m };
          if (r) n[instance] = r;
          else delete n[instance];
          return n;
        }),
    }),
    [apply, id],
  );

  const run = useCallback(
    async (actionId: string, extra: DispatchExtra = {}) => {
      const action = specRef.current?.actions.find((a) => a.id === actionId);
      if (!action || action.disabledReason || pendingRef.current.has(actionId)) return;
      setWithdrawnNotes([]);
      setPending((p) => new Set(p).add(actionId));
      try {
        await storeRef.current?.flush();
        activeRef.current = actionId;
        await dispatchAction(action, deps, extra);
      } catch (e) {
        setFormResults((m) => ({ ...m, [extra.instance ?? "__global"]: { kind: "error", message: e instanceof ApiError ? (e.userMessage ?? "That did not go through. Nothing was changed.") : "That did not go through. Nothing was changed." } }));
      } finally {
        if (activeRef.current === actionId) activeRef.current = null;
        setPending((p) => {
          const n = new Set(p);
          n.delete(actionId);
          return n;
        });
      }
    },
    [deps],
  );

  const ask = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || !specRef.current) return;
      setAsking(true);
      const ticket = seq.current.ticket();
      try {
        storeRef.current?.setAsk("");
        apply(await api.ask(id, t, specRef.current.revision), ticket);
      } catch (e) {
        setFormResults((m) => ({ ...m, __global: { kind: "error", message: e instanceof ApiError ? (e.userMessage ?? "ASAP could not take that request. Try again.") : "ASAP could not take that request. Try again." } }));
      } finally {
        setAsking(false);
      }
    },
    [apply, id],
  );

  if (error)
    return (
      <div className="x-card" role="alert" style={{ maxWidth: 640 }}>
        <h2>{error.status === 404 ? "Not available" : error.status === 0 ? "Not connected" : "Could not be opened"}</h2>
        <p className="x-muted" style={{ marginTop: 8 }}>
          {error.message}
        </p>
        <div className="x-row" style={{ marginTop: 16 }}>
          <button type="button" className="x-btn" onClick={() => navigate("/")}>
            Back to Home
          </button>
          {error.status !== 404 ? (
            <button type="button" className="x-btn" onClick={() => void load()}>
              Try again
            </button>
          ) : null}
        </div>
      </div>
    );
  if (!view || !storeRef.current)
    return (
      <div className="x-l-stack" data-gap="normal" aria-busy="true" aria-label="ASAP is composing this">
        <span className="x-working">ASAP is composing this</span>
        <div className="x-card">
          <div className="x-skeleton" style={{ width: "40%" }} />
          <div className="x-skeleton" style={{ width: "80%", marginTop: 12 }} />
          <div className="x-skeleton" style={{ width: "65%", marginTop: 12 }} />
        </div>
      </div>
    );

  const global = formResults["__global"];
  return (
    <ExperienceProvider value={{ spec: view.spec, store: storeRef.current, run, pending, formResults, changed: view.changed, added: view.added, narrow }}>
      <AskProvider value={{ ask, busy: asking }}>
        <div className="x-l-stack" data-gap="normal" data-experience={view.spec.intent.kind}>
          {withdrawnNotes.map((n) => (
            <p key={n} className="x-notice x-tone-gold" role="alert">
              {n}
            </p>
          ))}
          {global && global.kind !== "duplicates" ? (
            <p className="x-notice x-tone-red" role="alert">
              {global.message}
            </p>
          ) : null}
          <ExperienceRenderer />
        </div>
        <AskBar />
        {doc ? (
          <div className="x-overlay-scrim" role="presentation" onClick={() => setDoc(null)}>
            <div className="x-overlay-sheet" role="dialog" aria-modal="true" aria-label={doc.title} onClick={(e) => e.stopPropagation()}>
              <div className="x-overlay-head">
                <h2>{doc.title}</h2>
                <button type="button" className="x-btn x-btn-sm" onClick={() => setDoc(null)}>
                  Close
                </button>
              </div>
              <div className="x-overlay-body">
                <DocumentFrame documentId={doc.id} title={doc.title} />
              </div>
            </div>
          </div>
        ) : null}
      </AskProvider>
    </ExperienceProvider>
  );
}


/** Ask ASAP, inside the work: a request changes this work area, it does not open a transcript. */
function AskBar() {
  const { ask, busy } = useExperienceAsk();
  const { store, spec } = useExperience();
  const ui = useUi();
  const placeholder =
    spec.intent.kind === "renew_policy" ? "Ask about this renewal — “compare the quotes”, “what is blocking this?”" : spec.intent.kind === "explore_policies" ? "Refine — “only overdue”, “next month”, “all classes”" : "Ask ASAP";
  return (
    <form
      className="x-ask"
      role="search"
      aria-label="Ask ASAP about this work"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void ask(ui.ask);
      }}
    >
      <label htmlFor="x-ask-input" className="x-sr">
        Ask ASAP about this work
      </label>
      <input id="x-ask-input" value={ui.ask} maxLength={500} placeholder={placeholder} onChange={(e) => store.setAsk(e.target.value)} autoComplete="off" />
      <button type="submit" className="x-btn" data-primary="true" aria-disabled={busy || !ui.ask.trim() ? "true" : "false"}>
        {busy ? <span className="x-working">Working</span> : "Ask"}
      </button>
    </form>
  );
}
