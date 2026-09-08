import type { RunRow, WorkItemRow } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { WorkCard } from "../components/WorkCard.js";
import { EmptyState } from "../components/states.js";

/** Pure view, so tests render it with fixtures. Runs that did not finish are shown through their work item, never only in Activity. */
export function TodayView({
  items,
  runs,
  orgName,
}: {
  items: WorkItemRow[];
  runs: RunRow[];
  orgName: string;
}) {
  const needsYou = items.filter((i) => i.task_status === "needs_you");
  const today = new Date();
  const checksDue = items.filter(
    (i) =>
      i.task_status === "with_party" && i.task_next_check && new Date(i.task_next_check) <= today,
  );
  const stuck = runs.filter((r) => r.status === "paused" || r.status === "could_not_finish");
  const stuckItemIds = new Set(stuck.map((r) => r.work_item_id));
  const needsYouIds = new Set(needsYou.map((i) => i.id));
  // A run that could not finish and has no work item of its own is still reachable here.
  const orphanRuns = stuck.filter((r) => !r.work_item_id || !needsYouIds.has(r.work_item_id));

  if (needsYou.length === 0 && checksDue.length === 0 && orphanRuns.length === 0) {
    return (
      <EmptyState
        scope={`${orgName} today`}
        freshness="Nothing needs you right now. Checked just now."
        action={
          <Link
            to="/work"
            search={{ view: "with" }}
            className="text-sm text-accent-green underline"
          >
            See what is with others
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="needs-you" className="flex flex-col gap-3">
        <h2 id="needs-you" className="text-xl font-semibold text-ink">
          Needs you
        </h2>
        {needsYou.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing needs you right now.</p>
        )}
        {needsYou.map((item) => (
          <WorkCard
            key={item.id}
            item={item}
            showWhy
            footer={
              stuckItemIds.has(item.id) ? (
                <p className="text-sm text-accent-red">
                  ASAP could not finish:{" "}
                  {stuck.find((r) => r.work_item_id === item.id)?.next_step ?? "check this item"}.
                </p>
              ) : undefined
            }
          />
        ))}
        {orphanRuns.map((r) => (
          <p key={r.id} className="rounded-card bg-accent-red-soft p-4 text-sm text-ink">
            {r.title}: ASAP could not finish. {r.next_step ?? "Check this run."}{" "}
            <Link to="/r/$recordId" params={{ recordId: r.id }} className="underline">
              Open
            </Link>
          </p>
        ))}
      </section>
      {checksDue.length > 0 && (
        <section aria-labelledby="checks-due" className="flex flex-col gap-3">
          <h2 id="checks-due" className="text-xl font-semibold text-ink">
            Checks due
          </h2>
          {checksDue.map((item) => (
            <WorkCard key={item.id} item={item} showWhy />
          ))}
        </section>
      )}
    </div>
  );
}
