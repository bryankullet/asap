import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderConversation, renderSheet, renderSpace, renderToast } from "../views/space-views.js";
import { parse, sameRef, surfaceForRef, toPath, type Ref, type Surface } from "./routes.js";
import { ActivitySurface, AutomationsSurface, HomeSurface, WorkSurface } from "./Surfaces.js";
import { KIND_ICON, type RecentItem, type ShellAdapters, type ShellController, type Logic } from "./types.js";
import "./shell.css";

/**
 * The adaptive shell (D-155). The interface adapts to what the person is doing instead of keeping
 * one Chat + Space layout everywhere:
 *
 *  Home           full width, calm, no transcript
 *  Conversation   centred, while asking, creating, clarifying or approving
 *  Space          full width; chat closed unless asked for ("Ask about this" opens a drawer)
 *  Split          the conversation beside the Space it opened, only while both are useful
 *  Work, Automations, Activity   full-width purpose-built surfaces, no chat
 *
 * The address is the open surface (routes.ts). Recent, Pins and conversations are the server's;
 * the only thing kept in the browser is an unsent message, which is harmless interface state.
 */

const DRAFT_KEY = "asap.drafts";
const SIDE_KEY = "asap.sidebar";
const readDrafts = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
};
const writeDraft = (key: string, value: string) => {
  try {
    const all = readDrafts();
    if (value) all[key] = value;
    else delete all[key];
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the draft lasts as long as the page */
  }
};

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

export function AdaptiveShell({ logic, v, controller, orgKey }: { logic: Logic; v: Record<string, unknown>; controller: ShellController; orgKey: string }) {
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const surface = useMemo(() => parse(location.pathname, typeof location.search === "string" ? location.search : location.searchStr), [location]);
  const mobile = useMedia("(max-width: 899px)");
  const A = logic.A as ShellAdapters | undefined;
  const ready = !!(v["ready"] ?? logic.state.ready) && !!A;

  const go = useCallback((s: Surface, opts: { replace?: boolean } = {}) => {
    const path = toPath(s);
    if (path === location.pathname + (location.searchStr || "")) return;
    if (opts.replace) router.history.replace(path);
    else router.history.push(path);
  }, [router, location]);

  // ---------------------------------------------------------------- server-backed Recent / Pins
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [pins, setPins] = useState<RecentItem[]>([]);
  const refreshLists = useCallback(async () => {
    if (!A?.shell) return;
    const [r, p] = await Promise.all([A.shell.recent().catch(() => []), A.shell.pins().catch(() => [])]);
    setRecent(r);
    setPins(p);
  }, [A]);
  useEffect(() => {
    if (ready) void refreshLists();
  }, [ready, refreshLists]);

  // A brokerage switch clears every inherited context at once (D-155).
  const lastOrg = useRef(orgKey);
  useEffect(() => {
    if (lastOrg.current !== orgKey) {
      lastOrg.current = orgKey;
      logic.clearContext();
      setRecent([]);
      setPins([]);
      go({ mode: "home" }, { replace: true });
    }
  }, [orgKey, logic, go]);

  // ---------------------------------------------------------------- the URL drives the logic
  const [conversation, setConversation] = useState<{ id: string; title: string; statusLabel: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    const ref = surface.mode === "space" ? surface.ref : surface.mode === "conversation" ? surface.space : null;
    logic.setSurface(ref);
    const cid = surface.mode === "conversation" ? surface.conversationId : surface.mode === "space" && surface.drawer && surface.drawer !== "new" ? surface.drawer : null;
    const wantsChat = surface.mode === "conversation" || (surface.mode === "space" && surface.drawer);
    if (wantsChat && (cid || null) !== (logic.state.conversationId || null)) void logic.openConversation(cid);
    if (!wantsChat && logic.state.conversationId) void logic.openConversation(null);
    if (cid && A?.shell) {
      void A.shell.session(cid).then((c) => setConversation({ id: c.id, title: c.title, statusLabel: c.statusLabel })).catch(() => setConversation(null));
      void A.shell.recordOpen({ conversationId: cid }).then(refreshLists);
    } else setConversation(null);
  }, [ready, surface, logic, A, refreshLists]);

  // A Space opened is a Space in Recent, named as the Space names itself.
  const ws = v["ws"] as { kind?: string; title?: string; statusLabel?: string } | undefined;
  const spaceRef = surface.mode === "space" ? surface.ref : surface.mode === "conversation" ? surface.space : null;
  const spaceTitle = ws?.title || "";
  const spaceKey = spaceRef ? JSON.stringify(spaceRef) : "";
  useEffect(() => {
    if (!ready || !A?.shell || !spaceRef || !spaceTitle || /^(Loading|Opening)/.test(spaceTitle)) return;
    if (["newclient", "newcontact", "nothing"].includes(spaceRef.ws)) return;
    const t = setTimeout(() => void A.shell.recordOpen({ ref: spaceRef, title: spaceTitle.slice(0, 160) }).then(refreshLists), 400);
    return () => clearTimeout(t);
    // spaceKey stands for spaceRef: the same record, not the same object, decides.
  }, [ready, A, spaceKey, spaceTitle, refreshLists]);

  // ---------------------------------------------------------------- the controller the logic calls
  controller.open = (ref: Ref) => {
    const target = surfaceForRef(ref);
    if (target.mode !== "space") return go(target);
    if (surface.mode === "conversation") {
      if (sameRef(surface.space, ref)) return;
      // The conversation now controls this Space: the server learns the link (never the browser).
      if (surface.conversationId && A?.shell) void A.shell.update(surface.conversationId, { spaceRef: ref, ...(typeof ref["workItemId"] === "string" ? { workItemId: ref["workItemId"] as string } : {}) }).catch(() => {});
      return go({ mode: "conversation", conversationId: surface.conversationId, space: ref });
    }
    if (surface.mode === "space") {
      if (sameRef(surface.ref, ref)) return;
      return go({ mode: "space", ref, drawer: surface.drawer });
    }
    return go(target);
  };
  controller.home = () => go({ mode: "home" });
  controller.search = () => setPalette("search");
  controller.ensureConversation = async (text: string) => {
    if (!A?.shell) return null;
    const ctxRef = surface.mode === "space" ? surface.ref : surface.mode === "conversation" ? surface.space : null;
    const scope = ctxRef && typeof ctxRef["clientId"] === "string" ? { kind: "client" as const, id: ctxRef["clientId"] as string } : { kind: "brokerage" as const, id: null };
    try {
      const r = await A.shell.start({ text, scope, workItemId: ctxRef && typeof ctxRef["workItemId"] === "string" ? (ctxRef["workItemId"] as string) : null, spaceRef: ctxRef });
      const id = r.conversation.id;
      await logic.openConversation(id);
      setConversation({ id, title: r.conversation.title, statusLabel: r.conversation.statusLabel });
      if (surface.mode === "space") go({ mode: "space", ref: surface.ref, drawer: id }, { replace: true });
      else go({ mode: "conversation", conversationId: id, space: surface.mode === "conversation" ? surface.space : null }, { replace: surface.mode === "conversation" });
      void refreshLists();
      return id;
    } catch {
      logic.flash("ASAP could not start that conversation. Nothing was changed — try again.");
      return null;
    }
  };

  // ---------------------------------------------------------------- composer drafts (interface state only)
  const draftKey = logic.state.conversationId || (surface.mode === "space" ? `space:${toPath(surface)}` : "new");
  useEffect(() => {
    const el = (logic.inputRef as { current: HTMLTextAreaElement | null }).current;
    if (!el) return;
    const saved = readDrafts()[draftKey];
    if (saved && !el.value) el.value = saved;
    const onInput = () => writeDraft(draftKey, el.value);
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  });
  // A sent message is no longer a draft.
  const threadLen = (logic.state.thread || []).length;
  useEffect(() => {
    const el = (logic.inputRef as { current: HTMLTextAreaElement | null }).current;
    if (el && !el.value) writeDraft(draftKey, "");
  }, [threadLen, draftKey, logic.inputRef]);

  // ---------------------------------------------------------------- sidebar, palette, pin
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const toggleSide = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDE_KEY, c ? "open" : "collapsed");
      } catch {
        /* a layout preference only */
      }
      return !c;
    });
  const [palette, setPalette] = useState<null | "search" | "new" | "more">(null);
  const [splitWidth, setSplitWidth] = useState(460);

  const pinTarget = surface.mode === "conversation" && surface.conversationId && !surface.space ? { conversationId: surface.conversationId } : spaceRef ? { ref: spaceRef, title: spaceTitle || spaceRef.ws } : null;
  const pinKey = useMemo(() => {
    if (!pinTarget) return null;
    if ("conversationId" in pinTarget) return `conversation:${pinTarget.conversationId}`;
    return recent.find((r) => r.ref && sameRef(r.ref as Ref, pinTarget.ref))?.key ?? null;
  }, [pinTarget, recent]);
  const pinned = pinKey ? pins.some((p) => p.key === pinKey) : false;
  const togglePin = async () => {
    if (!A?.shell || !pinTarget) return;
    try {
      if (pinned && pinKey) await A.shell.unpin(pinKey);
      else await A.shell.pin(pinTarget);
      await refreshLists();
    } catch {
      logic.flash("The pin could not be saved. Nothing was changed.");
    }
  };

  const openItem = (r: RecentItem) => {
    setPalette(null);
    if (r.conversationId) return go({ mode: "conversation", conversationId: r.conversationId, space: null });
    if (r.ref) return go(surfaceForRef(r.ref as Ref));
  };

  // ---------------------------------------------------------------- what the main area holds
  const askAbout = () => {
    if (surface.mode !== "space") return;
    go({ mode: "space", ref: surface.ref, drawer: "new" });
  };
  const closeDrawer = () => surface.mode === "space" && go({ mode: "space", ref: surface.ref, drawer: null });
  const closeChatKeepSpace = () => surface.mode === "conversation" && surface.space && go({ mode: "space", ref: surface.space, drawer: null });
  const closeSpaceKeepChat = () => surface.mode === "conversation" && go({ mode: "conversation", conversationId: surface.conversationId, space: null });
  const reopenSpace = () => {
    if (surface.mode !== "conversation") return;
    const fromSession = conversation && A?.shell ? null : null;
    void fromSession;
    const last = logic.state.ref as Ref | null;
    if (last) go({ mode: "conversation", conversationId: surface.conversationId, space: last });
  };

  const rename = async (title: string) => {
    if (!conversation || !A?.shell) return;
    try {
      const c = await A.shell.update(conversation.id, { title });
      setConversation({ id: c.id, title: c.title, statusLabel: c.statusLabel });
      void refreshLists();
    } catch {
      logic.flash("That name could not be saved. Use 3 to 120 characters.");
    }
  };

  const meta = headerFor(surface, { conversation, spaceTitle, wsKind: ws?.kind });
  const conversationEl = ready ? renderConversation(v) : null;
  const spaceEl = ready ? renderSpace(v) : null;

  let main: ReactNode;
  if (!ready) main = <div className="sh-loading" role="status">Opening your brokerage…</div>;
  else if (surface.mode === "home")
    main = <HomeSurface logic={logic} A={A} recent={recent} onOpenRecent={openItem} onOpen={(ref) => go(surfaceForRef(ref))} onAsk={(text) => void logic.ask(text)} onFiles={(files) => void startWithFiles(files)} onNew={() => setPalette("new")} />;
  else if (surface.mode === "work") main = <WorkSurface logic={logic} A={A} view={surface.view} onView={(view) => go({ mode: "work", view }, { replace: true })} onOpen={(ref) => go(surfaceForRef(ref))} />;
  else if (surface.mode === "automations") main = <AutomationsSurface logic={logic} A={A} onOpen={(ref) => go(surfaceForRef(ref))} />;
  else if (surface.mode === "activity") main = <ActivitySurface logic={logic} filter={surface.filter} onFilter={(filter) => go({ mode: "activity", filter }, { replace: true })} onOpen={(ref) => go(surfaceForRef(ref))} />;
  else if (surface.mode === "conversation" && (!surface.space || mobile)) {
    main = (
      <div className="sh-conv-center" data-layout="conversation">
        {mobile && surface.space ? <div className="sh-mobile-switch"><button type="button" onClick={() => go({ mode: "space", ref: surface.space!, drawer: surface.conversationId ?? "new" })}>Open Space · {spaceTitle || "workspace"} →</button></div> : null}
        {!mobile && logic.state.ref ? <div className="sh-conv-reopen"><button type="button" onClick={reopenSpace}>Show {spaceTitle || "the Space"} beside the conversation</button></div> : null}
        {conversationEl}
      </div>
    );
  } else if (surface.mode === "conversation" && surface.space) {
    main = (
      <div className="sh-split" data-layout="split" style={{ gridTemplateColumns: `${splitWidth}px 6px minmax(0,1fr)` }}>
        <div className="sh-split-conv">
          <div className="sh-pane-bar">
            <span className="sh-pane-label">Conversation</span>
            <button type="button" onClick={closeChatKeepSpace} aria-label="Close the conversation and expand the Space">Close chat</button>
          </div>
          {conversationEl}
        </div>
        <Resizer width={splitWidth} onWidth={setSplitWidth} />
        <div className="sh-split-space">
          <div className="sh-pane-bar">
            <span className="sh-pane-label">{ws?.kind || "Space"}</span>
            <span className="sh-pane-actions">
              <button type="button" onClick={() => go({ mode: "space", ref: surface.space!, drawer: surface.conversationId })}>Expand</button>
              <button type="button" onClick={closeSpaceKeepChat} aria-label="Close the Space and centre the conversation">Close Space</button>
            </span>
          </div>
          {spaceEl}
        </div>
      </div>
    );
  } else if (surface.mode === "space") {
    const drawerOpen = !!surface.drawer && !mobile;
    main = mobile && surface.drawer ? (
      <div className="sh-conv-center" data-layout="conversation">
        <div className="sh-mobile-switch"><button type="button" onClick={closeDrawer}>← Back to {spaceTitle || "the Space"}</button></div>
        {conversationEl}
      </div>
    ) : (
      <div className={drawerOpen ? "sh-space sh-space-drawer" : "sh-space"} data-layout="space">
        <div className="sh-space-main">{spaceEl}</div>
        {drawerOpen ? (
          <aside className="sh-drawer" aria-label={`Ask about ${spaceTitle}`}>
            <div className="sh-pane-bar">
              <span className="sh-pane-label">Ask about {spaceTitle || "this"}</span>
              <button type="button" onClick={closeDrawer} aria-label="Close the conversation">Close</button>
            </div>
            {conversationEl}
          </aside>
        ) : null}
      </div>
    );
  }

  async function startWithFiles(files: File[]) {
    if (!files.length) return;
    const id = await controller.ensureConversation(files.length === 1 ? `Upload ${files[0]!.name}` : "Upload documents");
    if (id) void logic.chatFiles(files);
  }

  const back = () => router.history.back();
  const forward = () => router.history.forward();
  const active = surface.mode === "space" && surface.ref.ws === "automation" ? "automations" : surface.mode;

  return (
    <div className={`sh-root${collapsed && !mobile ? " sh-collapsed" : ""}${mobile ? " sh-mobile" : ""}`}>
      {!mobile ? (
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSide}
          active={active}
          recent={recent}
          pins={pins}
          me={(v["me"] as { name: string; initials: string; roleLabel: string }) || { name: "", initials: "", roleLabel: "" }}
          brokerage={String(v["brokerageName"] || "")}
          go={go}
          onSearch={() => setPalette("search")}
          onNew={() => setPalette("new")}
          onOpen={openItem}
          onProfile={() => logic.openProfile()}
          currentKey={pinKey}
        />
      ) : null}
      <div className="sh-main">
        <header className="sh-header">
          <div className="sh-header-left">
            {!mobile && (meta.history || surface.mode === "space" || surface.mode === "conversation") ? (
              <span className="sh-nav-buttons">
                <button type="button" onClick={back} aria-label="Back" title="Back">←</button>
                <button type="button" onClick={forward} aria-label="Forward" title="Forward">→</button>
              </span>
            ) : null}
            {mobile && (surface.mode === "space" || surface.mode === "conversation") ? (
              <button type="button" className="sh-mobile-back" onClick={back} aria-label="Back">←</button>
            ) : null}
            <div className="sh-titles">
              {meta.crumb ? <div className="sh-crumb">{meta.crumb}</div> : null}
              {conversation && (surface.mode === "conversation") ? (
                <EditableTitle value={conversation.title} onSave={rename} status={conversation.statusLabel} />
              ) : (
                <h2 className="sh-title" title={meta.title}>{meta.title}</h2>
              )}
            </div>
          </div>
          <div className="sh-header-actions">
            {surface.mode === "space" && !surface.drawer ? (
              <button type="button" className="sh-primary-ghost" onClick={askAbout}>✦ Ask about this</button>
            ) : null}
            {surface.mode === "space" && spaceRef && typeof spaceRef["clientId"] === "string" && !mobile ? (
              <button type="button" onClick={() => go({ mode: "activity", filter: { clientId: spaceRef["clientId"] as string } })}>Activity</button>
            ) : null}
            {pinTarget ? (
              <button type="button" aria-pressed={pinned} onClick={() => void togglePin()} title={pinned ? "Unpin" : "Pin — keep it at the top of Recent"}>
                {pinned ? "★ Pinned" : "☆ Pin"}
              </button>
            ) : null}
            {!mobile ? (
              <button type="button" className="sh-search-btn" onClick={() => setPalette("search")} aria-label="Search (Ctrl K)">⌕ Search <kbd>⌘K</kbd></button>
            ) : (
              <button type="button" onClick={() => setPalette("search")} aria-label="Search">⌕</button>
            )}
          </div>
        </header>
        <main className="sh-body">{main}</main>
        {mobile ? <MobileNav active={active} go={go} onMore={() => setPalette("more")} onAsk={() => go({ mode: "conversation", conversationId: null, space: null })} /> : null}
      </div>
      {palette === "search" ? <SearchPalette A={A} logic={logic} onClose={() => setPalette(null)} onPick={(r) => { setPalette(null); r(); }} go={go} /> : null}
      {palette === "new" ? <NewSheet onClose={() => setPalette(null)} go={go} onFiles={(f) => { setPalette(null); void startWithFiles(f); }} /> : null}
      {palette === "more" ? <MoreSheet onClose={() => setPalette(null)} go={go} recent={recent} onOpen={openItem} onSearch={() => setPalette("search")} onNew={() => setPalette("new")} onProfile={() => { setPalette(null); logic.openProfile(); }} /> : null}
      {ready ? renderToast(v) : null}
      {ready ? renderSheet(v) : null}
    </div>
  );
}

function headerFor(s: Surface, o: { conversation: { title: string } | null; spaceTitle: string; wsKind?: string | undefined }): { title: string; crumb: string | null; history: boolean } {
  switch (s.mode) {
    case "home":
      return { title: "Home", crumb: null, history: false };
    case "work":
      return { title: "Work", crumb: null, history: false };
    case "automations":
      return { title: "Automations", crumb: null, history: false };
    case "activity":
      return { title: "Activity", crumb: null, history: false };
    case "conversation":
      return { title: o.conversation?.title || "New conversation", crumb: s.space ? `Conversation · ${o.spaceTitle}` : "Conversation", history: true };
    case "space":
      return { title: o.spaceTitle || "Opening…", crumb: o.wsKind || null, history: true };
  }
}

function EditableTitle({ value, onSave, status }: { value: string; onSave: (v: string) => void; status: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing)
    return (
      <form
        className="sh-title-form"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
        }}
      >
        <input aria-label="Conversation name" value={draft} maxLength={120} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
      </form>
    );
  return (
    <div className="sh-title-row">
      <h2 className="sh-title" title={value}>{value}</h2>
      <button type="button" className="sh-rename" onClick={() => setEditing(true)} aria-label="Rename this conversation">Rename</button>
      <span className="sh-status-pill">{status}</span>
    </div>
  );
}

function Resizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation"
      aria-valuenow={width}
      aria-valuemin={360}
      aria-valuemax={720}
      tabIndex={0}
      className="sh-resizer"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidth(Math.max(360, width - 24));
        if (e.key === "ArrowRight") onWidth(Math.min(720, width + 24));
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const start = width;
        const move = (ev: MouseEvent) => onWidth(Math.min(720, Math.max(360, start + ev.clientX - startX)));
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

const NAV: [Surface["mode"], string, string, Surface][] = [
  ["home", "⌂", "Home", { mode: "home" }],
  ["work", "▱", "Work", { mode: "work", view: "needs_me" }],
  ["automations", "⌘", "Automations", { mode: "automations" }],
  ["activity", "◷", "Activity", { mode: "activity", filter: {} }],
];

function Sidebar(p: {
  collapsed: boolean; onToggle: () => void; active: string; recent: RecentItem[]; pins: RecentItem[];
  me: { name: string; initials: string; roleLabel: string }; brokerage: string; go: (s: Surface) => void;
  onSearch: () => void; onNew: () => void; onOpen: (r: RecentItem) => void; onProfile: () => void; currentKey: string | null;
}) {
  const [recentOpen, setRecentOpen] = useState(true);
  const pinnedKeys = new Set(p.pins.map((x) => x.key));
  const list = [...p.pins, ...p.recent.filter((r) => !pinnedKeys.has(r.key))].slice(0, 14);
  return (
    <nav className="sh-side" aria-label="Main">
      <div className="sh-brand">
        <span className="sh-logo">A</span>
        <span className="sh-label sh-brand-name">ASAP</span>
        <button type="button" className="sh-collapse" onClick={p.onToggle} aria-label={p.collapsed ? "Expand menu" : "Collapse menu to icons"} title={p.collapsed ? "Expand menu" : "Collapse menu"}>
          {p.collapsed ? "›" : "‹"}
        </button>
      </div>
      <ul className="sh-nav">
        {NAV.map(([key, icon, label, s]) => (
          <li key={key}>
            <button type="button" className={p.active === key ? "sh-nav-item sh-on" : "sh-nav-item"} aria-current={p.active === key ? "page" : undefined} onClick={() => p.go(s)} title={label}>
              <span className="sh-icon" aria-hidden>{icon}</span>
              <span className="sh-label">{label}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="sh-nav-item" onClick={p.onSearch} title="Search">
            <span className="sh-icon" aria-hidden>⌕</span>
            <span className="sh-label">Search</span>
          </button>
        </li>
        <li>
          <button type="button" className="sh-nav-item sh-new" onClick={p.onNew} title="New">
            <span className="sh-icon" aria-hidden>＋</span>
            <span className="sh-label">New</span>
          </button>
        </li>
      </ul>
      <div className="sh-recent">
        <button type="button" className="sh-recent-head sh-label" aria-expanded={recentOpen} onClick={() => setRecentOpen((o) => !o)}>
          Recent <span aria-hidden>{recentOpen ? "▾" : "▸"}</span>
        </button>
        {recentOpen && !p.collapsed ? (
          <ul>
            {list.length === 0 ? <li className="sh-recent-empty">What you open appears here.</li> : null}
            {list.map((r) => (
              <li key={r.key}>
                <button type="button" className={p.currentKey === r.key ? "sh-recent-item sh-on" : "sh-recent-item"} onClick={() => p.onOpen(r)} title={r.title}>
                  <span className="sh-kind" aria-label={r.kind}>{KIND_ICON[r.kind] ?? "•"}</span>
                  <span className="sh-recent-title">{r.title}</span>
                  {r.pinned || pinnedKeys.has(r.key) ? <span className="sh-pin-dot" aria-label="Pinned">★</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="sh-foot">
        <button type="button" className="sh-nav-item" onClick={() => p.go({ mode: "space", ref: { ws: "settings" }, drawer: null })} title="Settings">
          <span className="sh-icon" aria-hidden>⚙</span>
          <span className="sh-label">Settings</span>
        </button>
        <button type="button" className="sh-nav-item" onClick={() => p.go({ mode: "space", ref: { ws: "connections" }, drawer: null })} title="Connections">
          <span className="sh-icon" aria-hidden>⇄</span>
          <span className="sh-label">Connections</span>
        </button>
        <button type="button" className="sh-account" onClick={p.onProfile} title={p.me.name}>
          <span className="sh-avatar">{p.me.initials}</span>
          <span className="sh-label sh-account-text">
            <strong>{p.me.name}</strong>
            <small>{p.brokerage}</small>
          </span>
        </button>
      </div>
    </nav>
  );
}

function MobileNav({ active, go, onMore, onAsk }: { active: string; go: (s: Surface) => void; onMore: () => void; onAsk: () => void }) {
  const item = (key: string, icon: string, label: string, onClick: () => void, extra = "") => (
    <button type="button" className={`sh-mnav-item${active === key ? " sh-on" : ""}${extra}`} aria-current={active === key ? "page" : undefined} onClick={onClick}>
      <span aria-hidden>{icon}</span>
      <small>{label}</small>
    </button>
  );
  return (
    <nav className="sh-mnav" aria-label="Main">
      {item("home", "⌂", "Home", () => go({ mode: "home" }))}
      {item("work", "▱", "Work", () => go({ mode: "work", view: "needs_me" }))}
      {item("conversation", "✦", "Ask", onAsk, " sh-mnav-ask")}
      {item("automations", "⌘", "Automations", () => go({ mode: "automations" }))}
      {item("more", "⋯", "More", onMore)}
    </nav>
  );
}

function Sheet({ title, onClose, children, label }: { title: string; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="sh-overlay">
      <button type="button" className="sh-scrim" aria-label="Close" onClick={onClose} />
      <div ref={ref} className="sh-palette" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sh-palette-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchPalette({ A, logic, onClose, onPick, go }: { A: ShellAdapters | undefined; logic: Logic; onClose: () => void; onPick: (f: () => void) => void; go: (s: Surface) => void }) {
  const [q, setQ] = useState("");
  const [sessions, setSessions] = useState<{ id: string; title: string; statusLabel: string; client: { name: string } | null }[]>([]);
  useEffect(() => {
    if (!A?.shell) return;
    const t = setTimeout(() => void A.shell.sessions(q.trim() || undefined).then(setSessions).catch(() => setSessions([])), 160);
    return () => clearTimeout(t);
  }, [q, A]);
  const R = (logic.A as { records?: { sel: { search(q: string): { title: string; note: string; kind: string; target: Ref }[] } } } | undefined)?.records;
  const hits = q.trim() && R ? R.sel.search(q.trim()).slice(0, 12) : [];
  return (
    <Sheet title="Search" onClose={onClose} label="Search every record and conversation">
      <input className="sh-search-input" placeholder="Client, policy number, registration, claim reference, conversation…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div className="sh-results">
        {sessions.length ? <div className="sh-results-label">Conversations</div> : null}
        {sessions.slice(0, 8).map((c) => (
          <button key={c.id} type="button" className="sh-result" onClick={() => onPick(() => go({ mode: "conversation", conversationId: c.id, space: null }))}>
            <span className="sh-kind">✦</span>
            <span><strong>{c.title}</strong><small>{[c.client?.name, c.statusLabel].filter(Boolean).join(" · ")}</small></span>
          </button>
        ))}
        {hits.length ? <div className="sh-results-label">Records</div> : null}
        {hits.map((h, i) => (
          <button key={i} type="button" className="sh-result" onClick={() => onPick(() => go(surfaceForRef(h.target)))}>
            <span className="sh-kind">{KIND_ICON[h.kind?.toLowerCase?.() as keyof typeof KIND_ICON] ?? "•"}</span>
            <span><strong>{h.title}</strong><small>{[h.kind, h.note].filter(Boolean).join(" · ")}</small></span>
          </button>
        ))}
        {q.trim() && !hits.length && !sessions.length ? <p className="sh-empty">Nothing matches “{q.trim()}”. Nothing was changed.</p> : null}
        {!q.trim() ? <p className="sh-empty">Type to search clients, policies, vehicles, claims, documents, work and your conversations.</p> : null}
      </div>
    </Sheet>
  );
}

function NewSheet({ onClose, go, onFiles }: { onClose: () => void; go: (s: Surface) => void; onFiles: (f: File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const space = (ref: Ref) => () => {
    onClose();
    go({ mode: "space", ref, drawer: null });
  };
  // Choosing opens the real workflow or conversation; nothing is created by choosing.
  const options: [string, string, string, () => void][] = [
    ["✦", "Start with Ask ASAP", "Describe the work in your own words", () => { onClose(); go({ mode: "conversation", conversationId: null, space: null }); }],
    ["⤒", "Upload documents", "Policy schedules, quotes, claim forms, photos", () => fileRef.current?.click()],
    ["▦", "Import spreadsheet", "Clients and policies from Excel or CSV", space({ ws: "import" })],
    ["◎", "Add client", "A client by name, then their people and policies", space({ ws: "newclient" })],
    ["↻", "Prepare renewal", "Every renewal ASAP is preparing, and starting one", space({ ws: "renewal" })],
    ["▱", "Start quotation", "New business from a client request", space({ ws: "quote" })],
    ["⚑", "Report claim", "A loss against a policy", space({ ws: "claim" })],
    ["⌘", "Create automation", "Teach ASAP what to prepare, and when", space({ ws: "automation", create: "1" })],
  ];
  return (
    <Sheet title="New" onClose={onClose} label="Start something new">
      <div className="sh-new-grid">
        {options.map(([icon, title, note, run]) => (
          <button key={title} type="button" className="sh-new-option" onClick={run}>
            <span className="sh-new-icon" aria-hidden>{icon}</span>
            <span><strong>{title}</strong><small>{note}</small></span>
          </button>
        ))}
      </div>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles([...(e.target.files || [])])} />
    </Sheet>
  );
}

function MoreSheet({ onClose, go, recent, onOpen, onSearch, onNew, onProfile }: { onClose: () => void; go: (s: Surface) => void; recent: RecentItem[]; onOpen: (r: RecentItem) => void; onSearch: () => void; onNew: () => void; onProfile: () => void }) {
  const to = (s: Surface) => () => {
    onClose();
    go(s);
  };
  return (
    <Sheet title="More" onClose={onClose} label="More">
      <div className="sh-more">
        <button type="button" onClick={to({ mode: "activity", filter: {} })}>◷ Activity</button>
        <button type="button" onClick={onSearch}>⌕ Search</button>
        <button type="button" onClick={onNew}>＋ New</button>
        <button type="button" onClick={to({ mode: "space", ref: { ws: "settings" }, drawer: null })}>⚙ Settings</button>
        <button type="button" onClick={to({ mode: "space", ref: { ws: "connections" }, drawer: null })}>⇄ Connections</button>
        <button type="button" onClick={onProfile}>◉ Account</button>
      </div>
      <div className="sh-results-label">Recent</div>
      <div className="sh-results">
        {recent.length === 0 ? <p className="sh-empty">What you open appears here.</p> : null}
        {recent.slice(0, 12).map((r) => (
          <button key={r.key} type="button" className="sh-result" onClick={() => onOpen(r)}>
            <span className="sh-kind">{KIND_ICON[r.kind] ?? "•"}</span>
            <span><strong>{r.title}</strong><small>{r.kind}</small></span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
