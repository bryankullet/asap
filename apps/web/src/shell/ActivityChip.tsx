import type { RunRow } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@asap/ui";
import { ActivityPanelSlot, RunStatus } from "../components/status/slots.js";

/**
 * Runs the chip shows (spec Part 8, ui-contract "Runs and Activity"):
 *
 * - `working` and `paused` — live now, always shown.
 * - `could_not_finish` and `stopped` — a run that ended without doing its job. Always shown,
 *   whenever it ended: the contract says hiding Activity must not hide a failure, and the chip
 *   showing nothing while two runs could not finish is exactly that failure. Work still carries
 *   the item, so this is a second route to it, never the only one.
 * - `finished` — only since this session began, because a success from last week is not news.
 */
export function chipRuns(runs: RunRow[], sessionStart: Date): RunRow[] {
  return runs.filter(
    (r) =>
      r.status === "working" ||
      r.status === "paused" ||
      r.status === "could_not_finish" ||
      r.status === "stopped" ||
      (r.status === "finished" && r.ended_at !== null && new Date(r.ended_at) >= sessionStart),
  );
}

/** Optional by design: hiding it must hide no decision or failure, which live in Work. */
export function ActivityChip({ runs, sessionStart }: { runs: RunRow[]; sessionStart: Date }) {
  const [open, setOpen] = useState(false);
  const visible = chipRuns(runs, sessionStart);
  if (visible.length === 0) return null;
  const working = visible.filter((r) => r.status === "working").length;
  const needsPerson = visible.some(
    (r) => r.status === "could_not_finish" || r.status === "stopped" || r.status === "paused",
  );
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="activity-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-wash px-2.5 py-1.5 text-sm font-semibold text-ink-secondary hover:border-line-hover"
      >
        <span
          aria-hidden
          className={
            working > 0
              ? "h-[7px] w-[7px] animate-pulse rounded-full bg-accent-green"
              : needsPerson
                ? "h-[7px] w-[7px] rounded-full bg-accent-red"
                : "h-[7px] w-[7px] rounded-full bg-dot-neutral"
          }
        />
        Activity
        <span className="text-xs text-ink-muted">{visible.length}</span>
      </button>
      {open && (
        <Card
          id="activity-panel"
          role="region"
          aria-label="Activity"
          className="absolute right-0 bottom-full mb-2 w-[min(360px,80vw)] p-3 shadow-card"
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
        </Card>
      )}
    </div>
  );
}
