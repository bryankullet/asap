import type { JobCardView, RunListFilter } from "@asap/schema";
import { JOB_FILTERS } from "../shell/nav.js";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { MissingData } from "../components/states.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useRunList } from "../lib/queries.js";
import { useQuery } from "@tanstack/react-query";
import { RunDetail } from "../views/RunDetail.js";
import { LoadingList, ErrorState } from "../components/states.js";
import { jobCardFromRow } from "../live/adapters.js";

/**
 * Jobs — what ASAP is processing (D-064).
 *
 * A destination of its own because it answers a different question from Work. Work is what a
 * *person* owns; Jobs is what *ASAP* is doing. Showing both, separately, is how a broker can see
 * that the software is working without being misled about what that means.
 *
 * The vocabulary is deliberately not Work's, and the outcome language is deliberately specific:
 * "comparison prepared", never "policy renewed". A finished Job is an output. Whether cover was
 * confirmed, a claim accepted or money received is a different fact, on a different record, with
 * its own evidence.
 */

export function Jobs() {
  const { filter } = useSearch({ strict: false }) as { filter?: string };
  const me = useMe();
  const active = (filter ?? "all") as RunListFilter;

  /*
   * A real brokerage's Jobs board: grouped, counted and capped by the API under the caller's
   * session (D-066). Progress comes back derived from the work's steps — never authored here, and
   * null when there is nothing to derive it from (§45 rule 10).
   */
  const live = useRunList(me.data?.active_organization?.id, active);

  const groups: { title: string; cards: JobCardView[] }[] = (live.data?.groups ?? []).map((g) => ({
    title: g.title,
    cards: g.items.map((row) => jobCardFromRow(row, g.title)),
  }));

  const counts: Partial<Record<RunListFilter, number>> = live.data?.counts ?? {};

  return (
    <>
      <ScreenTitle
        title="Jobs"
        meta="See what ASAP is preparing and what it is waiting for"
        actions={
          <div className="top-actions">
            <Link to="/jobs" search={{ filter: "all" }} className="secondary">
              Filter
            </Link>
            <Link to="/ask" className="new-btn">
              ＋ Ask ASAP
            </Link>
          </div>
        }
      />

      <section className="page-scroll jobs-page">
        <nav className="tab-row" aria-label="Job states">
          {JOB_FILTERS.map((f) => {
            const count = counts[f.id] ?? 0;
            return (
              <Link
                key={f.id}
                to="/jobs"
                search={{ filter: f.id }}
                aria-current={f.id === active ? "page" : undefined}
                className={`tab ${f.id === active ? "selected" : ""}`}
              >
                {f.label} {f.id !== "completed" && count > 0 && <b>{count}</b>}
              </Link>
            );
          })}
        </nav>

        {/* Loading, partial, error and empty are all designed states (§36). */}
        {live.isPending && (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>Reading what ASAP is doing…</strong>
          </article>
        )}
        {live.isError && (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>We could not read the jobs.</strong>
            <p style={{ color: "#707a72", fontSize: 11 }}>{describeApiError(live.error)}</p>
            <button type="button" className="secondary" onClick={() => void live.refetch()}>
              Try again
            </button>
          </article>
        )}
        {(live.data?.degraded ?? []).map((d) => (
          <article className="warning" key={d.what}>
            <strong>{d.what}:</strong> {d.because} The jobs below were read.
          </article>
        ))}

        {groups.length === 0 && !live.isPending && !live.isError ? (
          <article className="space-card" style={{ padding: 24 }}>
            <strong>Nothing is in this view.</strong>
            <p style={{ color: "#707a72", fontSize: 11 }}>
              That is the honest answer, not an empty box. Jobs appear here as ASAP starts them.
            </p>
          </article>
        ) : (
          <div className="job-groups">
            {groups.map((g) => (
              <div className="job-group" key={g.title}>
                <div className="group-title">
                  <span>{g.title}</span>
                  <b>{g.cards.length}</b>
                </div>
                {g.cards.map((c) => (
                  <JobCard key={c.id} card={c} />
                ))}
              </div>
            ))}
          </div>
        )}
        {live.data && live.data.visible > live.data.returned && (
          <p style={{ color: "#707a72", fontSize: 11 }}>
            Showing {live.data.returned} of {live.data.visible}.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One job, in the approved card: its icon, the headline and badge, the record it belongs
 * to, the progress bar where there is progress, and the live note.
 *
 * Progress is read from the job's own steps, never authored (§45 rule 10), and the outcome
 * language stays specific: "comparison prepared", never "policy renewed".
 */
function JobCard({ card }: { card: JobCardView }) {
  return (
    <article className="job-card">
      <div className={`job-icon ${card.iconTone === "green" ? "" : card.iconTone}`} aria-hidden>
        {card.icon}
      </div>
      <div className="job-main">
        <div className="job-title">
          <strong>{card.headline}</strong>
          <span className={`job-pill ${card.pillTone}`}>{card.pillLabel}</span>
        </div>
        <p>{card.contextLine}</p>
        {card.progress !== null && (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={card.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${card.headline} progress`}
          >
            <i style={{ width: `${card.progress}%` }} />
          </div>
        )}
        <small>{card.note}</small>
      </div>
      <Link to={card.href} className="link">
        {card.actionLabel}
      </Link>
    </article>
  );
}

/**
 * One job: the run ASAP actually performed, its steps, its evidence and the work it belongs to.
 *
 * The same `RunDetail` the record page shows, so a job reached from the board and a job reached
 * from its record are one screen with one source — the engine's own run row (§45 rule 10).
 */
export function JobDetail() {
  const { jobId = "" } = useParams({ strict: false }) as { jobId?: string };
  const detail = useQuery({
    queryKey: ["run_detail", jobId],
    queryFn: () => api.run(jobId),
    retry: false,
  });

  if (detail.isPending) return <LoadingList rows={3} label="Loading the job" />;
  if (detail.isError) {
    return (
      <ErrorState
        what={`We could not read this job. ${describeApiError(detail.error)}`}
        retry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data) {
    return (
      <MissingData
        what="No job with that id"
        why="It may have finished and been cleared, or your role in this brokerage cannot see it."
      />
    );
  }
  return (
    <>
      <Link to="/jobs" search={{ filter: "all" }} className="crumb">
        ← Jobs
      </Link>
      <RunDetail data={detail.data} />
    </>
  );
}
