import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RunRow } from "@asap/schema";
import { tabKey, type TabIdentity, type WorkspaceTab, type WorkspaceTabs } from "./workspace-tabs.js";

/**
 * The permanent workspace header (61px), spanning the Space *and* the Ask panel.
 *
 * It is one row in the prototype: the open tabs on the left, and Recent, Activity and the Ask
 * toggle on the right. It sits above both columns rather than inside the Space, which is what
 * makes it permanent — a header inside the pane would scroll away with the content and would have
 * to be rebuilt on every screen.
 *
 * `min-height` is 56px and it measures 61px, because the tab row carries 8px of vertical padding.
 */
export function WorkspaceHeader(props: {
  tabs: WorkspaceTabs;
  activePath: string;
  runs: RunRow[];
  askOpen: boolean;
  onToggleAsk: () => void;
}) {
  const { tabs, close, togglePin, recent } = props.tabs;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  /*
   * A run worth a dot: one that is working now. Activity stays optional — it never becomes the only
   * place something important lives, because anything needing a person is in Work first.
   */
  const live = props.runs.some((r) => r.status === "working");

  return (
    <header className="shell-wsheader">
      <div className="shell-tabs" role="tablist" aria-label="Open workspaces">
        {tabs.length === 0 && (
          <span className="shell-tab-kind" style={{ opacity: 0.55, paddingInline: 4 }}>
            NO OPEN SPACES
          </span>
        )}
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const active = tab.path === props.activePath;
          return (
            <span
              key={key}
              className="shell-tab"
              data-active={active}
              role="tab"
              aria-selected={active}
            >
              <Link to={tab.path} className="shell-tab-open" title={tab.title}>
                <small className="shell-tab-kind">{tab.kind}</small>
                <strong className="shell-tab-title">{tab.title}</strong>
              </Link>

              <button
                type="button"
                className="shell-tab-btn"
                data-pinned={tab.pinned}
                aria-label={tab.pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`}
                aria-pressed={tab.pinned}
                onClick={() => togglePin(tab)}
              >
                ✚
              </button>

              <TabMore
                tab={tab}
                open={openMenu === key}
                onOpen={() => setOpenMenu(openMenu === key ? null : key)}
                onClose={() => setOpenMenu(null)}
                onCloseTab={() => close(tab)}
                onTogglePin={() => togglePin(tab)}
              />

              {/*
               * Closes the interface tab and nothing else. The label says so, because a bare × on
               * something that represents a renewal invites the reading that it ends the renewal.
               */}
              <button
                type="button"
                className="shell-tab-btn shell-tab-close"
                aria-label={`Close the ${tab.title} tab — the record is not changed`}
                onClick={() => close(tab)}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      <div className="shell-wsactions">
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="shell-wsbtn"
            aria-expanded={showRecent}
            onClick={() => setShowRecent((v) => !v)}
          >
            Recent
          </button>
          {showRecent && <RecentList recent={recent} onDismiss={() => setShowRecent(false)} />}
        </div>

        {/* Activity, where runs reach a person. Jobs is not a destination (D-074). */}
        <Link to="/jobs" search={{ filter: "all" }} className="shell-wsbtn" data-live={live}>
          <span aria-hidden className="shell-dot" />
          Activity
        </Link>

        <button type="button" className="shell-wsbtn" onClick={props.onToggleAsk}>
          {props.askOpen ? "Collapse Ask" : "Open Ask ASAP"}
        </button>
      </div>
    </header>
  );
}

/**
 * The tab's own menu. Pin and close live here as well as on the strip, because the icons are small
 * and a named item is what makes "close" unambiguous.
 */
function TabMore(props: {
  tab: WorkspaceTab;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCloseTab: () => void;
  onTogglePin: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [props.open, props]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="shell-tab-btn"
        aria-label={`More for ${props.tab.title}`}
        aria-expanded={props.open}
        onClick={props.onOpen}
      >
        •••
      </button>
      {props.open && (
        <div
          role="menu"
          className="rounded-control border border-line bg-paper shadow-modal"
          style={{ position: "absolute", top: "100%", right: 0, zIndex: 30, minWidth: 210, padding: 6 }}
        >
          <button
            type="button"
            role="menuitem"
            className="shell-menu-item"
            onClick={() => {
              props.onTogglePin();
              props.onClose();
            }}
          >
            {props.tab.pinned ? "Unpin this workspace" : "Pin this workspace"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="shell-menu-item"
            onClick={() => {
              props.onCloseTab();
              props.onClose();
            }}
          >
            Close this tab
          </button>
          <p className="px-2 pb-1 pt-2 text-tiny text-ink-muted">
            Closing a tab leaves the record exactly as it is.
          </p>
        </div>
      )}
    </div>
  );
}

/** Recently opened Spaces. Reading it costs nothing; it is derived from what was opened. */
function RecentList(props: { recent: WorkspaceTab[]; onDismiss: () => void }) {
  if (props.recent.length === 0) {
    return (
      <div className="shell-popover">
        <p className="text-tiny text-ink-muted">Nothing opened yet in this browser.</p>
      </div>
    );
  }
  return (
    <div className="shell-popover" role="menu" aria-label="Recent workspaces">
      {props.recent.map((tab) => (
        <Link
          key={tabKey(tab)}
          to={tab.path}
          role="menuitem"
          className="shell-menu-item"
          onClick={props.onDismiss}
        >
          <small className="shell-tab-kind">{tab.kind}</small>
          <span className="block text-body-lg">{tab.title}</span>
        </Link>
      ))}
    </div>
  );
}

export type { TabIdentity };
