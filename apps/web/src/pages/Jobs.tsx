import { DEMO_NOTICE, demoClient, type DemoJob } from "@asap/schema";
import { JOB_FILTERS } from "../shell/nav.js";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";
import { MissingData } from "../components/states.js";

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

const STATE_TONE: Record<DemoJob["state"], string> = {
  running: "bg-accent-green-soft text-accent-green-ink",
  waiting: "bg-accent-gold-soft text-accent-gold-ink",
  needs_human: "bg-accent-gold-soft text-accent-gold-ink",
  completed: "bg-wash text-ink-muted",
  failed: "bg-accent-red-soft text-accent-red-ink",
};

const STATE_WORD: Record<DemoJob["state"], string> = {
  running: "Running",
  waiting: "Waiting",
  needs_human: "Needs a person",
  completed: "Completed",
  failed: "Could not finish",
};

export function Jobs() {
  const { filter } = useSearch({ strict: false }) as { filter?: string };
  const demo = useDemo();
  const active = filter ?? "running";
  const shown = demo.jobs.filter((j) => j.state === active);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Jobs</h1>
        <p className="text-sm text-ink-secondary">
          What ASAP is doing. Work is what you own; this is what the software is processing for you.
        </p>
      </header>

      <nav aria-label="Job states" className="flex flex-wrap gap-1.5">
        {JOB_FILTERS.map((f) => {
          const count = demo.jobs.filter((j) => j.state === f.id).length;
          return (
            <Link
              key={f.id}
              to="/jobs"
              search={{ filter: f.id }}
              aria-current={f.id === active ? "page" : undefined}
              className={`rounded-pill px-3 py-1 text-sm ${
                f.id === active
                  ? "bg-navy text-paper"
                  : "border border-line-strong text-ink-secondary hover:border-ink-muted"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing is {STATE_WORD[active as DemoJob["state"]]?.toLowerCase() ?? "here"} right now.
          That is the honest answer, not an empty box.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((j) => (
            <li key={j.id}>
              <JobRow job={j} />
            </li>
          ))}
        </ul>
      )}

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}

function JobRow({ job }: { job: DemoJob }) {
  const client = demoClient(job.clientId);
  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line-strong bg-paper p-3.5">
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          to="/jobs/$jobId"
          params={{ jobId: job.id }}
          className="font-medium text-ink hover:underline"
        >
          {job.title}
        </Link>
        {/* Outcome language, not status language. */}
        <p className="text-sm text-ink-secondary">{job.outcome}</p>
        {client && <p className="text-xs text-ink-muted">{client.shortName}</p>}
      </div>
      <span className={`rounded-pill px-2.5 py-0.5 text-xs ${STATE_TONE[job.state]}`}>
        {STATE_WORD[job.state]}
      </span>
    </article>
  );
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
        <Link to="/jobs" search={{ filter: job.state }} className="text-sm text-ink-secondary hover:underline">
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
