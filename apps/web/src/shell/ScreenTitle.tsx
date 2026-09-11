import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * The demo's topbar: the screen's name and a meta line on the left, and the screen's own actions
 * on the right. Every screen has one, at the same 58px height, which is what makes the product
 * feel like one application rather than a set of pages.
 *
 * The actions are not the same on every screen — Discover offers search and "＋ New", Work and
 * Jobs offer a way into Ask, Automations offers a new automation — so the screen supplies them and
 * the default is the pair the demo uses most.
 */
export function ScreenTitle({
  title,
  meta,
  actions,
  crumbs,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
  /**
   * A record says where it sits rather than repeating its own name: "Policies / Commercial Motor
   * Fleet", as the approved demo draws it. The last crumb is the record; the ones before it are
   * where it lives.
   */
  crumbs?: string[];
}) {
  if (crumbs && crumbs.length > 0) {
    const last = crumbs[crumbs.length - 1]!;
    return (
      <header className="topbar">
        <div className="crumbs">
          {crumbs.slice(0, -1).map((c) => (
            <span key={c}>
              {c}
              <b> / </b>
            </span>
          ))}
          <strong>{last}</strong>
        </div>
        {actions ?? <TopActions />}
      </header>
    );
  }
  return (
    <header className="topbar">
      <div className="screen-title">
        <h1>{title}</h1>
        {meta && <span>{meta}</span>}
      </div>
      {actions ?? <TopActions />}
    </header>
  );
}

/** The pair the demo puts on most screens. */
function TopActions() {
  return (
    <div className="top-actions">
      {/* One text node each, as the original has them: a flex gap changes both widths. */}
      <Link to="/search" search={{ q: "" }} className="icon-btn" aria-label="Search">
        ⌕
      </Link>
      <Link to="/new" className="new-btn">
        ＋ New
      </Link>
    </div>
  );
}
