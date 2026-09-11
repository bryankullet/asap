import {
  DEMO_NOTICE,
  DEMO_TEAM,
  demoClient,
  scenarioById,
  type DemoWork,
} from "@asap/schema";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { WORK_FILTERS } from "../shell/nav.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { useState } from "react";
import { MissingData } from "../components/states.js";
import { PinList } from "../components/PinButton.js";
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

  /**
   * Active is everything a person still owns, which is what the approved demo's Work grid opens
   * on — not only the items whose own state word is "active". Waiting, For review and Completed
   * are the narrower reads.
   */
  const shown = demo.work.filter((w) => {
    if (active === "pinned") return demo.pinned.includes(w.id);
    if (active === "recent") return true;
    if (active === "active") return w.state !== "completed";
    return w.state === active;
  });
  const ordered =
    active === "recent"
      ? [...shown].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : shown;

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
            {WORK_FILTERS.map((f) => {
              // The demo counts only the three live filters; Completed, Pinned and Recent carry none.
              const count =
                f.id === "active"
                  ? demo.work.filter((w) => w.state !== "completed").length
                  : f.id === "waiting" || f.id === "review"
                    ? demo.work.filter((w) => w.state === f.id).length
                    : 0;
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
                    The count is read from the same state the grid filters on. The approved demo
                    prints a fixed 8/5/3 here that its own eight tiles contradict; a number that
                    disagrees with the list under it is not worth reproducing.
                  */}
                  {count > 0 && <b>{count}</b>}
                </Link>
              );
            })}
          </nav>

          {/*
            Outside demo mode the Pinned filter shows what a person actually kept, read from the
            API under their own session. In demo mode the rows already carry the session's pins.
          */}
          {active === "pinned" && !demo.isDemo && <PinList />}

          {ordered.length === 0 ? (
            <article className="space-card" style={{ padding: 24 }}>
              <strong>
                {active === "pinned" ? "You have not kept anything yet." : "No work in this view."}
              </strong>
              <p style={{ color: "#707a72", fontSize: 11 }}>
                {active === "pinned"
                  ? "Open an item and choose Keep to find it here."
                  : "Completed actions and new evidence will move items here automatically."}
              </p>
            </article>
          ) : (
            <div className="spaces-grid">
              {ordered.map((w) => (
                <WorkTile key={w.id} work={w} />
              ))}
            </div>
          )}
      </section>
    </>
  );
}

/**
 * One tile on the Work grid, in the approved demo's shape: the badge floated right, the kind of
 * work, the headline, the one-line reason, and the record it belongs to. Every string comes from
 * the fixture — a tile that named a client would stop being a tile.
 */
function WorkTile({ work }: { work: DemoWork }) {
  const tone =
    work.pill === "High" ? "high" : work.pill === "Resolved" ? "good" : "";
  return (
    <Link to="/work/$workId" params={{ workId: work.id }} className="space-tile">
      <span className={`pill ${tone}`}>{work.pill}</span>
      <div className="section-label">{work.workType} WORK</div>
      <h3>{work.headline}</h3>
      <p>{work.summary}</p>
      <small>{work.contextLabel}</small>
    </Link>
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
