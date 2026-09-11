import {
  DEMO_NOTICE,
  DEMO_TEAM,
  demoClient,
  scenarioById,
  type DemoWork,
} from "@asap/schema";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { WORK_FILTERS } from "../shell/nav.js";
import { useState } from "react";
import { MissingData } from "../components/states.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Work — the persistent library of tasks, decisions, investigations and follow-ups (D-064).
 *
 * The approved vocabulary throughout: Active, Waiting, For review, Completed, Pinned, Recent.
 * "Needs you" appears nowhere. Pinned is a filter here, not a destination — a personal marker is
 * a way of finding work, not a state work is in, and the distinction survives D-062.
 *
 * Every item opens a full context: why it is where it is, what it rests on, what ASAP has done
 * for it, and what a person can do next.
 */
const STATE_TONE: Record<DemoWork["state"], string> = {
  active: "bg-accent-green-soft text-accent-green-ink",
  waiting: "bg-accent-gold-soft text-accent-gold-ink",
  review: "bg-accent-gold-soft text-accent-gold-ink",
  completed: "bg-wash text-ink-muted",
};
const STATE_WORD: Record<DemoWork["state"], string> = {
  active: "Active",
  waiting: "Waiting",
  review: "For review",
  completed: "Completed",
};

export function WorkDemo() {
  const { view } = useSearch({ strict: false }) as { view?: string };
  const demo = useDemo();
  const active = view ?? "active";

  const shown = demo.work.filter((w) => {
    if (active === "pinned") return demo.pinned.includes(w.id);
    if (active === "recent") return true;
    return w.state === active;
  });
  const ordered =
    active === "recent"
      ? [...shown].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : shown;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Work</h1>
        <p className="text-sm text-ink-secondary">
          Everything the brokerage is carrying. Each item holds the evidence, the history and the
          next action for one task.
        </p>
      </header>

      <nav aria-label="Work filters" className="flex flex-wrap gap-1.5">
        {WORK_FILTERS.map((f) => {
          const count =
            f.id === "pinned"
              ? demo.pinned.length
              : f.id === "recent"
                ? demo.work.length
                : demo.work.filter((w) => w.state === f.id).length;
          return (
            <Link
              key={f.id}
              to="/work"
              search={{ view: f.id }}
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

      {ordered.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          {active === "pinned"
            ? "You have not kept anything yet. Open an item and choose Keep to find it here."
            : `Nothing is ${STATE_WORD[active as DemoWork["state"]]?.toLowerCase() ?? "here"} right now.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((w) => (
            <li key={w.id}>
              <WorkRow
                work={w}
                pinned={demo.pinned.includes(w.id)}
                onPin={() => demo.togglePin(w.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}

function WorkRow({
  work,
  pinned,
  onPin,
}: {
  work: DemoWork;
  pinned: boolean;
  onPin: () => void;
}) {
  const client = demoClient(work.clientId);
  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line-strong bg-paper p-3.5">
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          to="/work/$workId"
          params={{ workId: work.id }}
          className="font-medium text-ink hover:underline"
        >
          {work.title}
        </Link>
        <p className="text-sm text-ink-secondary">{work.reason}</p>
        <p className="text-xs text-ink-muted">
          {client?.shortName} · {work.owner}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPin}
          aria-pressed={pinned}
          className="rounded-pill border border-line-strong px-2.5 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
        >
          {pinned ? "★ Kept" : "☆ Keep"}
        </button>
        <span className={`rounded-pill px-2.5 py-0.5 text-xs ${STATE_TONE[work.state]}`}>
          {STATE_WORD[work.state]}
        </span>
      </div>
    </article>
  );
}

/** One Work item: why it is here, what ASAP did, its history, and what a person can do. */
export function WorkDetail() {
  const { workId = "" } = useParams({ strict: false }) as { workId?: string };
  const demo = useDemo();
  const work = demo.work.find((w) => w.id === workId);
  const [note, setNote] = useState("");

  if (!work) {
    return (
      <MissingData
        what="No work with that id"
        why="It may have been completed and cleared, or your role in this brokerage cannot see it."
      />
    );
  }
  const client = demoClient(work.clientId);
  const scenario = scenarioById(work.scenarioId);
  const jobs = demo.jobs.filter((j) => work.jobIds.includes(j.id));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/work" search={{ view: work.state }} className="text-sm text-ink-secondary hover:underline">
          ← Work
        </Link>
        <h1 className="font-heading text-xl font-semibold text-ink">{work.title}</h1>
        <p className="text-sm text-ink-secondary">{work.reason}</p>
        <p className="text-xs text-ink-muted">
          {client?.name} · {STATE_WORD[work.state]} · {work.owner}
        </p>
      </header>

      {scenario && (
        <section className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4">
          <h2 className="text-sm font-medium text-ink">What ASAP found</h2>
          <p className="text-sm text-ink">{scenario.lead}</p>
          <p className="text-sm text-ink-secondary">{scenario.text}</p>
          <Link
            to="/ask"
            search={{ scenario: scenario.id }}
            className="self-start text-sm text-ink underline"
          >
            Open this in Ask ASAP
          </Link>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-medium text-ink">What ASAP is processing</h2>
          {jobs.map((j) => (
            <Link
              key={j.id}
              to="/jobs/$jobId"
              params={{ jobId: j.id }}
              className="rounded-card border border-line-strong bg-paper p-3 text-sm text-ink hover:border-ink-muted"
            >
              {j.title}
              <span className="block text-xs text-ink-muted">{j.outcome}</span>
            </Link>
          ))}
        </section>
      )}

      <section aria-label="Actions" className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4">
        <h2 className="text-sm font-medium text-ink">What you can do</h2>
        <label className="text-xs text-ink-muted" htmlFor="decision-note">
          A note, kept with whatever you decide
        </label>
        <input
          id="decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-[38px] rounded-control border border-line-strong bg-paper px-3 text-sm"
          placeholder="Optional"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              demo.setWorkState(work.id, "completed", note || "Approved and completed by a person.")
            }
            className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
          >
            Approve and complete
          </button>
          <button
            type="button"
            onClick={() => demo.setWorkState(work.id, "waiting", note || "Waiting on the other party.")}
            className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
          >
            Mark waiting
          </button>
          <button
            type="button"
            onClick={() => demo.setWorkState(work.id, "active", note || "Back with us.")}
            className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
          >
            Bring back to active
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-ink-muted">Assign to</span>
          {DEMO_TEAM.map((person) => (
            <button
              key={person}
              type="button"
              onClick={() => demo.assign(work.id, person)}
              aria-pressed={work.owner === person}
              className={`rounded-pill px-2.5 py-0.5 text-xs ${
                work.owner === person
                  ? "bg-navy text-paper"
                  : "border border-line-strong text-ink-secondary hover:border-ink-muted"
              }`}
            >
              {person}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="History" className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium text-ink">History</h2>
        <ol className="flex flex-col gap-1.5 text-sm">
          {work.history.map(([when, what], i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-ink-muted">{when}</span>
              <span className="text-ink-secondary">{what}</span>
            </li>
          ))}
        </ol>
      </section>

      <DemoBoundary>
        {DEMO_NOTICE} Approving here changes demonstration state only.
      </DemoBoundary>
    </div>
  );
}
