import type { WorkTileView, WorkView } from "@asap/schema";
import { Link, useSearch } from "@tanstack/react-router";
import { describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkList } from "../lib/queries.js";
import { workTileFromRow } from "../live/adapters.js";
import {
  DEFAULT_WORK_FILTER,
  LEGACY_WORK_FILTERS,
  PINNED_VIEW,
  REVIEW_VIEW,
  WORK_FILTERS,
} from "../shell/nav.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { PinList } from "../components/PinButton.js";

/**
 * Work — the persistent library of tasks, decisions, investigations and follow-ups.
 *
 * The main views are the task-status layer (D-075): **Your work** (the default) · With others ·
 * In progress · Done · Recent. "Needs you" and a bare "Waiting" appear nowhere.
 *
 * Two things sit beside the views rather than among them, because neither is a state work is in:
 * **Pinned**, a personal marker with its own endpoint, and **For review**, which is contextual —
 * it collects what ASAP prepared and nobody has acted on, and it only appears when there is
 * something in it.
 *
 * Every item opens a full context: why it is where it is, what it rests on, what ASAP has done
 * for it, and what a person can do next.
 */
/** `?view=` is already the API's own vocabulary, so this resolves legacy ids and nothing else. */
function viewFor(raw: string | undefined): string {
  if (!raw) return DEFAULT_WORK_FILTER;
  return LEGACY_WORK_FILTERS[raw] ?? raw;
}

export function Work() {
  const { view } = useSearch({ strict: false }) as { view?: string };
  const me = useMe();
  const active = viewFor(view);

  /*
   * A real brokerage's Work, ranked and capped by the API under the caller's session. Pinned is
   * the exception: it is a personal marker with its own endpoint, so `PinList` renders it.
   */
  const live = useWorkList(
    me.data?.active_organization?.id,
    (active === PINNED_VIEW.id ? DEFAULT_WORK_FILTER : active) as WorkView,
  );

  const tiles = (live.data?.items ?? []).map(workTileFromRow);
  // The API counts every view in one pass, so a tab's number and the list under it are one answer.
  const counts = {
    needs: live.data?.counts.needs ?? 0,
    with: live.data?.counts.with ?? 0,
    progress: live.data?.counts.progress ?? 0,
    review: live.data?.counts.review ?? 0,
  } satisfies Record<string, number>;
  const pinnedTab = active === PINNED_VIEW.id;
  // For review earns its place only when something is in it (D-075).
  const showReview = counts.review > 0 || active === REVIEW_VIEW.id;

  return (
    <>
      <ScreenTitle
        title="Work"
        meta="Every task, decision and follow-up in one place"
        actions={
          <Link to="/ask" className="new-btn">
            ✦ Ask ASAP
          </Link>
        }
      />

      <section className="page-scroll spaces-page">
        <nav className="tab-row work-tabs" aria-label="Work filters">
          {[
            ...WORK_FILTERS,
            ...(showReview ? [REVIEW_VIEW] : []),
            PINNED_VIEW,
          ].map((f) => {
            // Done and Recent carry no count: neither is a queue.
            const count = (counts as Record<string, number>)[f.id] ?? 0;
            return (
              <Link
                key={f.id}
                to="/work"
                search={{ view: f.id }}
                aria-current={f.id === active ? "page" : undefined}
                className={`tab ${f.id === active ? "selected" : ""}`}
              >
                {f.label}{" "}
                {/*
                    The count comes from the same read as the list under it — the API counts every
                    view in one pass — so the two can never disagree.
                  */}
                {count > 0 && <b>{count}</b>}
              </Link>
            );
          })}
        </nav>

        {/* Pinned shows what this person kept, read under their own session. */}
        {pinnedTab && <PinList />}

        {/* Every system state is designed (§36): loading, partial, error, empty — never a blank. */}
        {!pinnedTab && live.isPending && (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>Reading your work…</strong>
          </article>
        )}
        {live.isError && (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>We could not read your work.</strong>
            <p style={{ color: "#707a72", fontSize: 11 }}>{describeApiError(live.error)}</p>
            <button type="button" className="secondary" onClick={() => void live.refetch()}>
              Try again
            </button>
          </article>
        )}
        {(live.data?.degraded ?? []).map((d) => (
          <article className="warning" key={d.what}>
            <strong>{d.what}:</strong> {d.because} Everything else below was read.
          </article>
        ))}

        {tiles.length === 0 && !live.isPending && !live.isError && !pinnedTab ? (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>No work in this view.</strong>
            <p style={{ color: "#707a72", fontSize: 11 }}>
              Completed actions and new evidence will move items here automatically.
            </p>
          </article>
        ) : (
          <div className="spaces-grid">
            {tiles.map((t) => (
              <WorkTile key={t.id} tile={t} />
            ))}
          </div>
        )}
        {live.data && live.data.visible > live.data.returned && (
          <p style={{ color: "#707a72", fontSize: 11, marginTop: 12 }}>
            Showing {live.data.returned} of {live.data.visible}. The rest are here when these are
            dealt with.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One tile on the Work grid, in the approved shape: the badge floated right, the kind of work,
 * the headline, the one-line reason, and the record it belongs to. Every string comes from the
 * brokerage's own row — a tile that named a client would stop being a tile.
 */
function WorkTile({ tile }: { tile: WorkTileView }) {
  // The three pill tones. `medium` takes the default, as it does there.
  const tone = tile.pillTone === "high" ? "high" : tile.pillTone === "resolved" ? "good" : "";
  return (
    <Link to={tile.href} className="space-tile">
      <span className={`pill ${tone}`}>{tile.pill}</span>
      <div className="section-label">{tile.workType} WORK</div>
      <h3>{tile.headline}</h3>
      <p>{tile.summary}</p>
      <small>{tile.contextLabel}</small>
    </Link>
  );
}
