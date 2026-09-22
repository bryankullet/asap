import { useMutation } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { useRuns, useWorkList } from "../lib/queries.js";
import { supabase } from "../lib/supabase.js";
import { NAV } from "./nav.js";
import { NewSheet } from "./NewSheet.js";
import { AskPanel } from "./AskPanel.js";
import { useAskPanel } from "./ask-width.js";
import { ProfileMenu } from "./ProfileMenu.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";
import { useWorkspaceTabs } from "./workspace-tabs.js";

/**
 * The permanent shell, at the prototype's measured values (docs/ui/PROTOTYPE-PARITY.md).
 *
 * Three regions, and the reason each is where it is:
 *
 *   sidebar │ workspace header, spanning both columns below it
 *           │ current Space │ Ask ASAP
 *
 * The header spans the Space *and* Ask rather than sitting inside the Space, which is what makes
 * it permanent: a header inside the pane scrolls away with the content and has to be rebuilt on
 * every screen. The sidebar is a fixed 228px track (68px collapsed) and Ask is a fixed 400px
 * track, so the workspace pane is the only thing that absorbs extra width — measured, going from
 * 1360 to 1440, the pane grows 732→812 and Ask does not move.
 *
 * What is not the prototype's: routing, the session, the organization switcher, and every value on
 * every screen. Those come from the API. The prototype's own store is a behaviour reference and
 * never production persistence.
 */

const SIDE_KEY = "asap.sidebar.collapsed.v1";

export function Shell() {
  const me = useMe();
  const invalidate = useInvalidateMe();
  const org = me.data?.active_organization;
  const path = useRouterState({ select: (s) => s.location.pathname });

  const switchOrg = useMutation({
    mutationFn: api.setActiveOrganization,
    onSuccess: () => void invalidate(),
  });

  /*
   * Collapsed or not is a harmless interface preference, so it persists and survives navigation —
   * a sidebar that springs back open on every route change is worse than one that never collapses.
   */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem(SIDE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleSide = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        globalThis.localStorage?.setItem(SIDE_KEY, String(next));
      } catch {
        /* A preference that cannot be saved is not an error worth showing. */
      }
      return next;
    });
  }, []);

  const tabs = useWorkspaceTabs(path);
  const ask = useAskPanel();
  /*
   * "+ New" is a sheet over whatever is on screen, not a destination. The Space behind it stays
   * mounted and stays in its tab, which is the whole reason it is a sheet: a person choosing to
   * start a claim has not left the renewal they were reading.
   */
  const [newOpen, setNewOpen] = useState(false);
  // `/new` exists so the sheet can be linked to and reopened. Landing there opens it.
  useEffect(() => {
    if (path === "/new") setNewOpen(true);
  }, [path]);
  const runs = useRuns(org?.id);

  // The prototype is a fixed-height application: the body never scrolls, the panes do.
  useEffect(() => {
    document.body.classList.add("demo-body");
    return () => document.body.classList.remove("demo-body");
  }, []);

  const person = me.data?.user;
  const membershipRole = me.data?.memberships.find((m) => m.organization.id === org?.id)?.role.name;
  const displayName = person?.display_name ?? person?.full_name ?? person?.email ?? "";
  const subtitle = membershipRole ?? org?.name ?? "";
  const initials =
    displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "A";

  return (
    <div className="shell-root demo-root">
      <div className="shell-frame" data-side={collapsed ? "collapsed" : "expanded"}>
        <aside className="shell-side">
          <div className="shell-brand">
            <Link to="/today" className="shell-brand-mark" aria-label="ASAP — Today">
              A
            </Link>
            <span className="shell-brand-word shell-navlabel">ASAP</span>
            <button
              type="button"
              className="shell-side-toggle"
              onClick={toggleSide}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand menu" : "Collapse menu"}
            >
              {collapsed ? "›" : "‹"}
            </button>
          </div>

          <nav aria-label="Main" className="shell-nav">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="shell-nav-item"
                title={item.label}
                aria-current={path.startsWith(item.to) ? "page" : undefined}
              >
                <span aria-hidden className="shell-nav-ico">
                  {item.glyph}
                </span>
                <span className="shell-navlabel">{item.label}</span>
                <NavCount to={item.to} />
              </Link>
            ))}
          </nav>

          <div className="shell-side-bottom">
            {/* The prototype's order below the destinations: New, then Search, then Profile. */}
            <button
              type="button"
              className="shell-nav-item shell-new"
              title="New"
              aria-haspopup="dialog"
              aria-expanded={newOpen}
              onClick={() => setNewOpen(true)}
            >
              <span aria-hidden className="shell-nav-ico">
                ＋
              </span>
              <span className="shell-navlabel">New</span>
            </button>
            <Link
              to="/search"
              search={{ q: "" }}
              className="shell-nav-item shell-search"
              title="Search"
            >
              <span aria-hidden className="shell-nav-ico">
                ⌕
              </span>
              <span className="shell-navlabel">Search</span>
              <kbd aria-hidden className="shell-navlabel">
                ⌘ K
              </kbd>
            </Link>

            <div className="shell-profile">
              <span aria-hidden className="shell-avatar">
                {initials}
              </span>
              <span className="shell-profile-text shell-navlabel">
                <strong>{displayName || "Signed in"}</strong>
                <small>{subtitle}</small>
              </span>
              <ProfileMenu
                me={me.data}
                switching={switchOrg.isPending}
                onSwitch={(id) => switchOrg.mutate(id)}
                onSignOut={() => void supabase.auth.signOut()}
              />
            </div>
          </div>
        </aside>

        <main className="shell-main">
          <WorkspaceHeader
            tabs={tabs}
            activePath={path}
            runs={runs.data ?? []}
            askOpen={ask.open}
            onToggleAsk={ask.toggle}
          />

          {/*
           * The width lives here, on the grid container, because that is what sizes the Ask
           * track. Set on the panel itself it would never reach the track and the grip would
           * move a number nothing read.
           */}
          <div
            className="shell-body"
            data-ask={ask.open ? "open" : "collapsed"}
            style={{ ["--shell-ask-width" as string]: `${ask.width}px` }}
          >
            <section className="shell-pane">
              <Outlet />
            </section>
            {ask.open && <AskPanel state={ask} contextLabel={contextLabel(path, tabs.tabs)} />}
          </div>

          {/*
           * Under 720px the sidebar is gone, so the destinations need somewhere else to live. It gets
           * its own accessible name: two navigations both called "Main" is one ambiguous landmark to a
           * screen reader, which is a real defect and not only a test problem.
           */}
          {newOpen && <NewSheet onClose={() => setNewOpen(false)} />}

      <nav className="shell-mobilenav" aria-label="Main, bottom bar">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={path.startsWith(item.to) ? "page" : undefined}
              >
                <span aria-hidden className="shell-nav-ico">
                  {item.glyph}
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
            <Link to="/new">
              <span aria-hidden className="shell-nav-ico">
                ＋
              </span>
              <span>New</span>
            </Link>
            <Link to="/search" search={{ q: "" }}>
              <span aria-hidden className="shell-nav-ico">
                ⌕
              </span>
              <span>Search</span>
            </Link>
          </nav>
        </main>
      </div>
    </div>
  );
}

/**
 * What Ask says it is looking at.
 *
 * The open tab whose path matches wins, because that is the thing on screen and it carries the
 * record's own name. Otherwise the destination, by name — never a guess at a record, because a
 * context chip naming the wrong client is worse than one naming none.
 */
function contextLabel(path: string, tabs: { path: string; kind: string; title: string }[]): string {
  const active = tabs.find((t) => t.path === path);
  if (active) return `${active.kind} · ${active.title}`;
  const nav = NAV.find((n) => path.startsWith(n.to));
  if (nav) return nav.label;
  return "This brokerage";
}

/**
 * The count beside a destination — from the same query the screen itself runs.
 *
 * One answer feeds both, so the sidebar and the list behind it cannot disagree. A count whose rows
 * nobody can reach is worse than no count, so it shows nothing until it has one.
 */
function NavCount({ to }: { to: string }) {
  const me = useMe();
  const orgId = me.data?.active_organization?.id;
  const work = useWorkList(orgId, "needs");
  const n = to === "/work" ? (work.data?.counts.needs ?? 0) : 0;
  if (n === 0) return null;
  return <span className="shell-nav-count shell-navlabel">{n}</span>;
}
