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
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="screen-title">
        <h1>{title}</h1>
        {meta && <span>{meta}</span>}
      </div>
      {actions ?? (
        <div className="top-actions">
          {/* One text node each, as the original has them: a flex gap changes both widths. */}
          <Link to="/search" search={{ q: "" }} className="icon-btn" aria-label="Search">
            ⌕
          </Link>
          <Link to="/new" className="new-btn">
            ＋ New
          </Link>
        </div>
      )}
    </header>
  );
}
