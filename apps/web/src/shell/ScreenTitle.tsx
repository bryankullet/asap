import { Link } from "@tanstack/react-router";

/**
 * The demo's topbar: the screen's name and a meta line on the left, a round search button and the
 * dark "+ New" button on the right. Every screen has one, at the same 58px height, which is what
 * makes the product feel like one application rather than a set of pages.
 */
export function ScreenTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="topbar">
      <div className="screen-title">
        <h1>{title}</h1>
        {meta && <span>{meta}</span>}
      </div>
      <div className="top-actions">
        {/* One text node each, as the original has them: a flex gap changes both widths. */}
        <Link to="/search" search={{ q: "" }} className="icon-btn" aria-label="Search">
          ⌕
        </Link>
        <Link to="/new" className="new-btn">
          ＋ New
        </Link>
      </div>
    </header>
  );
}
