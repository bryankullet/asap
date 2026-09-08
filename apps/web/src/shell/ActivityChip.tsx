import type { RunRow } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ActivityPanelSlot, RunStatus } from "../components/status/slots.js";

/** Runs the chip may show: working, paused, or finished since this session began (spec Part 8). */
export function chipRuns(runs: RunRow[], sessionStart: Date): RunRow[] {
  return runs.filter(
    (r) =>
      r.status === "working" ||
      r.status === "paused" ||
      (r.status === "finished" && r.ended_at !== null && new Date(r.ended_at) >= sessionStart),
  );
}

/** Optional by design: hiding it must hide no decision or failure, which live in Work. */
export function ActivityChip({ runs, sessionStart }: { runs: RunRow[]; sessionStart: Date }) {
  const [open, setOpen] = useState(false);
  const visible = chipRuns(runs, sessionStart);
  if (visible.length === 0) return null;
  const working = visible.filter((r) => r.status === "working").length;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="activity-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-pill bg-accent-green-soft px-3 py-1 text-sm text-accent-green"
      >
        <span
          aria-hidden
          className={
            working > 0
              ? "h-2 w-2 animate-pulse rounded-pill bg-accent-green"
              : "h-2 w-2 rounded-pill bg-ink-muted"
          }
        />
        Activity
        <span className="text-xs">{visible.length}</span>
      </button>
      {open && (
        <div
          id="activity-panel"
          role="region"
          aria-label="Activity"
          className="mt-2 rounded-card bg-paper p-3 shadow-card"
        >
          <ActivityPanelSlot>
            <ul className="flex flex-col gap-2">
              {visible.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <RunStatus status={r.status} />
                  <Link
                    to="/r/$recordId"
                    params={{ recordId: r.work_item_id ?? r.id }}
                    className="text-ink hover:underline"
                  >
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </ActivityPanelSlot>
        </div>
      )}
    </div>
  );
}
