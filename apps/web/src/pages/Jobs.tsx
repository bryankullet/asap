import { DEMO_NOTICE, demoClient, type DemoJob } from "@asap/schema";
import { JOB_FILTERS } from "../shell/nav.js";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";
import { MissingData } from "../components/states.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";

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

/** Which jobs each tab shows. "Work" is everything that has stopped and needs a person. */
function inFilter(job: DemoJob, filter: string): boolean {
  // The board's All is everything still live; a finished job has its own tab.
  if (filter === "all") return job.state !== "completed";
  if (filter === "work") return job.state === "needs_human" || job.state === "failed";
  return job.state === filter;
}

export function Jobs() {
  const { filter } = useSearch({ strict: false }) as { filter?: string };
  const demo = useDemo();
  const active = filter ?? "all";
  const shown = demo.jobs.filter((j) => inFilter(j, active));

  /** The demo groups the board by what a job is waiting on, in the fixtures' own order. */
  const groups: { title: string; jobs: DemoJob[] }[] = [];
  for (const j of shown) {
    const found = groups.find((g) => g.title === j.group);
    if (found) found.jobs.push(j);
    else groups.push({ title: j.group, jobs: [j] });
  }

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
            const count = demo.jobs.filter((j) => inFilter(j, f.id)).length;
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

        {groups.length === 0 ? (
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
                  <b>{g.jobs.length}</b>
                </div>
                {g.jobs.map((j) => (
                  <JobCard key={j.id} job={j} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/**
 * One job, in the approved demo's card: its icon, the headline and badge, the record it belongs
 * to, the progress bar where there is progress, and the live note.
 *
 * Progress is read from the job's own steps, never authored (§45 rule 10), and the outcome
 * language stays specific: "comparison prepared", never "policy renewed".
 */
function JobCard({ job }: { job: DemoJob }) {
  return (
    <article className="job-card">
      <div className={`job-icon ${job.iconTone === "green" ? "" : job.iconTone}`} aria-hidden>
        {job.icon}
      </div>
      <div className="job-main">
        <div className="job-title">
          <strong>{job.headline}</strong>
          <span className={`job-pill ${job.pillTone}`}>{job.pillLabel}</span>
        </div>
        <p>{job.contextLine}</p>
        {job.progress !== null && (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.headline} progress`}
          >
            <i style={{ width: `${job.progress}%` }} />
          </div>
        )}
        <small>{job.note}</small>
      </div>
      <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="link">
        {job.actionLabel}
      </Link>
    </article>
  );
}

/** The board tab a job belongs to, so its detail links back to where it was. */
function tabFor(job: DemoJob): "running" | "waiting" | "work" | "completed" {
  if (job.state === "needs_human" || job.state === "failed") return "work";
  return job.state;
}

/** One job, its steps, and the Work it belongs to. */
export function JobDetail() {
  const { jobId = "" } = useParams({ strict: false }) as { jobId?: string };
  const demo = useDemo();
  const job = demo.jobs.find((j) => j.id === jobId);
  if (!job) {
    return (
      <MissingData
        what="No job with that id"
        why="It may have finished and been cleared, or your role in this brokerage cannot see it."
      />
    );
  }
  const client = demoClient(job.clientId);
  const work = demo.work.find((w) => w.id === job.workId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/jobs"
          search={{ filter: tabFor(job) }}
          className="text-sm text-ink-secondary hover:underline"
        >
          ← Jobs
        </Link>
        <h1 className="font-heading text-xl font-semibold text-ink">{job.title}</h1>
        <p className="text-sm text-ink-secondary">{job.outcome}</p>
        {client && <p className="text-xs text-ink-muted">{client.name}</p>}
      </header>

      <section aria-label="Steps" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">What it did</h2>
        <ol className="flex flex-col gap-1.5">
          {job.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className={
                  s.state === "done"
                    ? "text-accent-green"
                    : s.state === "failed"
                      ? "text-accent-red"
                      : s.state === "now"
                        ? "text-accent-gold"
                        : "text-ink-muted"
                }
              >
                {s.state === "done" ? "✓" : s.state === "failed" ? "✗" : s.state === "now" ? "◴" : "○"}
              </span>
              <span className={s.state === "todo" ? "text-ink-muted" : "text-ink-secondary"}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* The separation, said out loud where it matters most. */}
      <p className="rounded-card border border-line-soft bg-wash px-3 py-2 text-sm text-ink-secondary">
        This is what ASAP did. Whether cover was confirmed, a claim accepted or money received is a
        separate fact, recorded against the policy with its own evidence.
      </p>

      {work && (
        <section aria-label="Related work" className="flex flex-col gap-1.5">
          <h2 className="text-sm font-medium text-ink">The work this belongs to</h2>
          <Link
            to="/work/$workId"
            params={{ workId: work.id }}
            className="rounded-card border border-line-strong bg-paper p-3 text-sm text-ink hover:border-ink-muted"
          >
            {work.title}
            <span className="block text-xs text-ink-muted">{work.reason}</span>
          </Link>
        </section>
      )}

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}
