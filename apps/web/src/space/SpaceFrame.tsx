import { Link } from "@tanstack/react-router";
import type { SpaceFrame } from "@asap/schema";
import { RelatedSpaces, SpaceBlockView } from "./blocks.js";
import type { ActHandler } from "./parts.js";
import { SpaceActions, SpaceEvidenceList, toneClass } from "./parts.js";

/**
 * The one renderer, for every Space.
 *
 * The approved prototype has no per-screen layouts: Today, Work, a client, a renewal and a claim
 * are the same thing — a titled workspace with a status, optional filters and a column of typed
 * blocks. So this is the whole composition of every authenticated screen, and adding a screen
 * means writing an adapter that produces a `SpaceFrame`, never writing a layout.
 *
 * Three things it refuses to do:
 *
 *  - **Render anything not in the registry.** Blocks are a closed discriminated union with no slot
 *    for markup, so a model choosing blocks cannot express a `<div>` (§45 rule 9).
 *  - **Author a status.** The pill shows what the adapter read from a column. There is no progress
 *    figure anywhere in a Space (§45 rule 10).
 *  - **Hide a gap.** Loading, empty, missing, degraded and error are each drawn, and "nothing
 *    needs you" is never shown to a brokerage that simply has nothing on file (§36).
 */
export function SpaceFrameView({
  space,
  onAct,
}: {
  space: SpaceFrame;
  onAct?: ActHandler | undefined;
}) {
  return (
    <section className="sp-space" aria-label={space.title}>
      <div className="sp-head">
        <div className="sp-head-text">
          <div className="sp-eyebrow">{space.self.label}</div>
          <h1 className="sp-title">{space.title}</h1>
          {space.context !== null && <p className="sp-context">{space.context}</p>}
        </div>
        <span className={`sp-status ${toneClass(space.status.tone)}`}>{space.status.label}</span>
      </div>

      {/*
       * Filter pills are links, so a filter changes what the server returns rather than hiding
       * rows the browser already has. That is also what makes a filtered view addressable, and
       * what lets each workspace tab keep its own filter.
       */}
      {space.filters.length > 0 && (
        <nav className="sp-filters" aria-label="Views">
          {space.filters.map((filter) => (
            <Link
              key={filter.id}
              to={filter.to}
              className="sp-filter"
              aria-current={filter.active ? "true" : undefined}
            >
              {filter.label}
              {filter.count !== null && <span className="sp-filter-count"> {filter.count}</span>}
            </Link>
          ))}
        </nav>
      )}

      {space.state === "ready" ? (
        <div className="sp-blocks">
          {space.blocks.map((block) => (
            <SpaceBlockView key={block.id} block={block} onAct={onAct} />
          ))}
        </div>
      ) : (
        <div className="sp-blocks">
          <SpaceState space={space} onAct={onAct} />
        </div>
      )}

      {space.evidence.length > 0 && (
        <div className="sp-blocks">
          <SpaceEvidenceList evidence={space.evidence} />
        </div>
      )}

      <RelatedSpaces related={space.related} />

      {/*
       * Partial success (§36): part of the answer could not be read, so the Space renders what it
       * has and says what it could not, rather than failing whole or passing the gap off as an
       * empty result. A board that shows "0 items" because a read failed has told a lie.
       */}
      {space.degraded.length > 0 && (
        <div className="sp-degraded" role="status">
          <strong>Some of this could not be read.</strong>
          <ul>
            {space.degraded.map((d, i) => (
              <li key={i}>
                {d.what} — {d.because}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The Space's own loading, empty and error states.
 *
 * `emptyState` carries its own words because the adapter knows which emptiness this is: a
 * brokerage with no clients and a brokerage that is up to date are different facts, and an empty
 * screen congratulating someone on being up to date when they have put nothing in yet is a lie of
 * omission (D-068).
 */
function SpaceState({ space, onAct }: { space: SpaceFrame; onAct?: ActHandler | undefined }) {
  if (space.state === "loading") {
    return (
      <div className="sp-block-state" data-state="loading" aria-busy="true">
        <span className="sr-only">Reading this brokerage&rsquo;s records.</span>
        <div className="sp-skeleton" style={{ width: "62%" }} />
        <div className="sp-skeleton" style={{ width: "40%" }} />
        <div className="sp-skeleton" style={{ width: "74%" }} />
      </div>
    );
  }
  if (space.state === "error") {
    return (
      <div className="sp-block-state" data-state="error" role="alert">
        {space.emptyState?.heading ?? "This could not be read."}
        {space.emptyState?.body !== undefined && space.emptyState.body !== "" && (
          <p style={{ margin: "6px 0 0" }}>{space.emptyState.body}</p>
        )}
      </div>
    );
  }
  const empty = space.emptyState;
  return (
    <div className="sp-empty">
      <h2 className="sp-empty-heading">{empty?.heading ?? "Nothing here yet."}</h2>
      {empty?.body !== undefined && empty.body !== "" && (
        <p className="sp-empty-body">{empty.body}</p>
      )}
      {empty !== null && empty.actions.length > 0 && (
        <div className="sp-empty-actions">
          <SpaceActions actions={empty.actions} onAct={onAct} primaryFirst />
        </div>
      )}
    </div>
  );
}
