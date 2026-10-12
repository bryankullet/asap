import type { LivingBlock, LivingSurface as Surface } from "@asap/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../lib/api.js";
import type { Ref } from "../shell/routes.js";
import type { PrefsStore } from "../shell/types.js";
import { useSurfacePrefs } from "./prefs.js";
import { BlockActions, EvidenceList, LIVING_RENDERERS, type BlockEnv } from "./blocks.js";
import "./living.css";

/**
 * A Living surface (D-156): the server composes and validates it; this renders registered blocks
 * and keeps them calm while they change.
 *
 * Visual inertia: blocks are keyed by their stable id, so a re-composed surface reconciles in place
 * — nothing remounts, scroll and focus stay. A block whose content hash changed is marked
 * "Updated" for a while; a block that appeared is marked "New". An unchanged fingerprint is not
 * even re-rendered. Pinned and collapsed blocks and selections inside blocks are the person's own
 * arrangement, kept on the server per brokerage, person and surface (D-157).
 */

const POLL_MS = 20_000;
const MARK_MS = 12_000;
type Marks = Record<string, { kind: "new" | "updated"; until: number }>;
type PrefList = "pinned" | "collapsed";
export type LivingLoader = () => Promise<Surface>;
/** A surface a person can change by asking (D-158): the portfolio's refine box, chips and choices. */
export type Refiner = { onRefine: (text: string) => void; onRemove: (field: string) => void; busy: boolean; placeholder: string };

/**
 * `identity` is what the surface is about: while it stays the same, a new `load` (a refined query)
 * re-reads and reconciles in place; a new identity starts afresh.
 */
export function LivingSurface({ identity, noun = "renewal", runId = null, load, prefsStore, refine, onOpen, onAsk, onTitle }: {
  identity: string;
  noun?: string;
  runId?: string | null;
  load: LivingLoader;
  prefsStore?: PrefsStore | undefined;
  refine?: Refiner;
  onOpen: (ref: Ref) => void;
  onAsk: (text: string) => void;
  onTitle?: (title: string) => void;
}) {
  const [surface, setSurface] = useState<Surface | null>(null);
  const [error, setError] = useState<{ status: number; code: string } | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [refreshing, setRefreshing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [surfaceKey, setSurfaceKey] = useState<string | null>(null);
  const { prefs, update } = useSurfacePrefs(prefsStore, surfaceKey);
  const last = useRef<Surface | null>(null);

  const fetchIt = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const next = await load();
      setError(null);
      const prev = last.current;
      if (prev && prev.fingerprint === next.fingerprint) return;
      if (prev) {
        const before = new Map(prev.blocks.map((b) => [b.id, b.hash]));
        const now = Date.now();
        setMarks((m) => {
          const out: Marks = Object.fromEntries(Object.entries(m).filter(([, v]) => v.until > now));
          for (const b of next.blocks) {
            if (!before.has(b.id)) out[b.id] = { kind: "new", until: now + MARK_MS };
            else if (before.get(b.id) !== b.hash) out[b.id] = { kind: "updated", until: now + MARK_MS };
          }
          return out;
        });
      } else setSurfaceKey(next.surfaceId);
      last.current = next;
      setSurface(next);
    } catch (e) {
      if (!last.current) setError(e instanceof ApiRequestError ? { status: e.status, code: e.code } : { status: 0, code: "unknown" });
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [load]);

  // A different subject starts afresh; a refined view of the same one reconciles in place.
  useEffect(() => {
    last.current = null;
    setSurface(null);
    setError(null);
    setMarks({});
  }, [identity]);

  useEffect(() => {
    void fetchIt();
    const t = setInterval(() => { if (document.visibilityState === "visible") void fetchIt(); }, POLL_MS);
    const onFocus = () => void fetchIt();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [fetchIt]);

  // Marks fade on their own; one timer, not one per block.
  useEffect(() => {
    const ids = Object.keys(marks);
    if (!ids.length) return;
    const soonest = Math.min(...Object.values(marks).map((m) => m.until));
    const t = setTimeout(() => setMarks((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.until > Date.now()))), Math.max(200, soonest - Date.now()));
    return () => clearTimeout(t);
  }, [marks]);

  const titleTo = useRef(onTitle);
  titleTo.current = onTitle;
  const subjectTitle = surface?.subject.title ?? null;
  useEffect(() => {
    if (subjectTitle && titleTo.current) titleTo.current(subjectTitle);
  }, [subjectTitle]);

  const steps = runId ? () => onOpen({ ws: "renewal", runId }) : null;

  if (error) {
    const unreachable = error.status === 0;
    const gone = error.status === 404 || error.status === 403;
    return (
      <div className="lv-scroll"><div className="lv-root">
        <div className="lv-state" role="status">
          <h2>{gone ? `This ${noun} is not available to you` : unreachable ? "Not connected yet" : "This workspace could not be composed"}</h2>
          <p>{gone ? "It may belong to another brokerage, or it was removed." : unreachable ? "ASAP could not reach the brokerage's service. Nothing is shown rather than an example." : `ASAP refused to show a workspace it could not validate. The ${noun} itself is unaffected.`}</p>
          <div className="lv-actions">
            <button type="button" className="lv-btn" onClick={() => void fetchIt(true)}>Try again</button>
            {steps && !gone ? <button type="button" className="lv-btn lv-btn-primary" onClick={steps}>Open the renewal steps</button> : null}
          </div>
        </div>
      </div></div>
    );
  }
  if (!surface) {
    return (
      <div className="lv-scroll"><div className="lv-root" aria-busy="true">
        <div className="lv-skeleton lv-skeleton-head" />
        <div className="lv-skeleton lv-skeleton-strip" />
        <div className="lv-grid"><div className="lv-col"><div className="lv-skeleton" /><div className="lv-skeleton" /></div><div className="lv-col"><div className="lv-skeleton" /></div></div>
        <span className="lv-sr" role="status">Composing the {noun} workspace…</span>
      </div></div>
    );
  }

  const env: BlockEnv = { open: onOpen, ask: onAsk, refresh: (r) => { if (r) setReceipt(r); void fetchIt(true); }, ...(refine ? { refine: refine.onRefine, removeChip: refine.onRemove } : {}) };
  const toggle = (key: PrefList, id: string) =>
    update((p) => {
      const set = new Set(p[key]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...p, [key]: [...set] };
    });
  const ordered = (role: LivingBlock["role"]) => {
    const list = surface.blocks.filter((b) => b.role === role);
    return [...list.filter((b) => prefs.pinned.includes(b.id)), ...list.filter((b) => !prefs.pinned.includes(b.id))];
  };
  const generated = new Date(surface.generatedAt);

  return (
    <div className="lv-scroll"><div className="lv-root" data-stage={surface.stage?.key ?? surface.purpose}>
      <div className="lv-bar">
        {surface.stage ? <span className="lv-bar-stage">{surface.stage.label}</span> : null}
        <span className="lv-bar-time" aria-live="polite">Updated {generated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="lv-bar-actions">
          <button type="button" className="lv-btn lv-btn-quiet" onClick={() => void fetchIt(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
          {steps ? <button type="button" className="lv-btn lv-btn-quiet" onClick={steps}>Renewal steps</button> : null}
        </span>
      </div>
      {receipt ? (
        <div className="lv-receipt" role="status">
          <span aria-hidden>✓</span><span>{receipt}</span>
          <button type="button" className="lv-btn lv-btn-quiet" onClick={() => setReceipt(null)}>Dismiss</button>
        </div>
      ) : null}
      {surface.unavailable.length ? (
        <div className="lv-unavailable" role="note">
          <strong>Part of this renewal could not be read for you.</strong>
          <span>{surface.unavailable.map((u) => `${u.part} (${u.reason === "restricted" ? "not available to your role" : "could not be loaded"})`).join(" · ")}. What is shown is what could be read; a gap here is not missing insurance information.</span>
        </div>
      ) : null}
      {refine ? <RefineBox refine={refine} /> : null}
      {ordered("lead").map((b) => <BlockView key={b.id} block={b} env={env} mark={marks[b.id]?.kind ?? null} lead />)}
      <div className={ordered("side").length ? "lv-grid" : "lv-grid lv-grid-single"}>
        <div className="lv-col lv-col-main">
          {ordered("main").map((b) => <BlockView key={b.id} block={b} env={env} mark={marks[b.id]?.kind ?? null} pinned={prefs.pinned.includes(b.id)} collapsed={prefs.collapsed.includes(b.id)} onPin={() => toggle("pinned", b.id)} onCollapse={() => toggle("collapsed", b.id)} />)}
          {ordered("main").length === 0 ? <div className="lv-block"><p className="lv-empty">Nothing is in progress on this renewal yet. ASAP shows the work here as soon as a record exists for it.</p></div> : null}
        </div>
        <aside className="lv-col lv-col-side" aria-label="Context">
          {ordered("side").map((b) => <BlockView key={b.id} block={b} env={env} mark={marks[b.id]?.kind ?? null} pinned={prefs.pinned.includes(b.id)} collapsed={prefs.collapsed.includes(b.id)} onPin={() => toggle("pinned", b.id)} onCollapse={() => toggle("collapsed", b.id)} />)}
        </aside>
      </div>
    </div></div>
  );
}

function BlockView({ block, env, mark, lead, pinned, collapsed, onPin, onCollapse }: {
  block: LivingBlock; env: BlockEnv; mark: "new" | "updated" | null; lead?: boolean; pinned?: boolean; collapsed?: boolean; onPin?: () => void; onCollapse?: () => void;
}) {
  const Render = LIVING_RENDERERS[block.component];
  if (!Render) return null;
  const showSources = block.evidence.length > 0 && block.component !== "EvidenceInspector";
  const bodyId = `lv-body-${block.id}`;
  return (
    <section className={`lv-block${lead ? " lv-lead" : ""}${mark ? ` lv-marked lv-${mark}` : ""}`} data-block={block.id} data-component={block.component} aria-labelledby={block.title ? `lv-h-${block.id}` : undefined}>
      {block.title || mark ? (
        <div className="lv-block-head">
          {block.title ? <h2 id={`lv-h-${block.id}`}>{block.title}</h2> : <span />}
          {mark ? <span className={`lv-mark lv-mark-${mark}`}>{mark === "new" ? "New" : "Updated"}</span> : null}
          {!lead && onPin && onCollapse ? (
            <span className="lv-block-tools">
              <button type="button" onClick={onPin} aria-pressed={pinned} title={pinned ? "Unpin" : "Pin to the top"}>{pinned ? "★" : "☆"}</button>
              <button type="button" onClick={onCollapse} aria-expanded={!collapsed} aria-controls={bodyId} title={collapsed ? "Expand" : "Collapse"}>{collapsed ? "▸" : "▾"}</button>
            </span>
          ) : null}
        </div>
      ) : null}
      {collapsed ? null : (
        <div id={bodyId}>
          <Render props={block.props} block={block} env={env} />
          {showSources ? (
            <details className="lv-sources">
              <summary>Sources ({block.evidence.length})</summary>
              <EvidenceList items={block.evidence} env={env} />
            </details>
          ) : null}
          <BlockActions actions={block.actions} env={env} />
        </div>
      )}
    </section>
  );
}

/** "Ask ASAP to change this view": a request in plain words becomes a refinement of the query. */
function RefineBox({ refine }: { refine: Refiner }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || refine.busy) return;
    refine.onRefine(t);
    setText("");
  };
  return (
    <form className="lv-refine" role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="lv-refine-mark" aria-hidden>✦</span>
      <label className="lv-sr" htmlFor="lv-refine-input">Ask ASAP to change this view</label>
      <input id="lv-refine-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={refine.placeholder} autoComplete="off" />
      <button type="submit" className="lv-btn lv-btn-primary" disabled={refine.busy || !text.trim()}>{refine.busy ? "Changing…" : "Change view"}</button>
    </form>
  );
}
