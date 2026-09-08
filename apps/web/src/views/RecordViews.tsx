import type { RunRow, WorkItemRow } from "@asap/schema";
import type { ReactNode } from "react";
import { Card, CardTitle } from "@asap/ui";
import {
  CoverStatus,
  MoneyRow,
  MoneyStatus,
  PolicyPeriodLine,
  RecordHeaderTask,
  RunDetailSlot,
  RunStatus,
  TaskStatus,
  formatSince,
} from "../components/status/slots.js";

const ACTOR_LABEL: Record<WorkItemRow["steps"][number]["actor"], string> = {
  asap: "ASAP",
  you: "You",
  insurer: "Insurer",
  client: "Client",
  bank: "Bank",
  finance: "Finance",
  regulator: "Regulator",
};

/** `/r/:recordId` for a work item: titled as itself, task status in the header, steps as they are. */
export function WorkItemView({
  item,
  runs,
  actions = null,
  live = null,
}: {
  item: WorkItemRow;
  runs: RunRow[];
  /** The current step's actions, supplied by the page so the view stays pure. */
  actions?: ReactNode;
  /** Messages from a run in progress, streamed. */
  live?: string[] | null;
}) {
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-ink">{item.title}</h1>
        <RecordHeaderTask>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <TaskStatus status={item.task_status} party={item.task_party} since={item.task_since} />
            {item.task_status === "with_party" && item.task_next_check && (
              <span>Next check {formatSince(item.task_next_check)}</span>
            )}
          </div>
        </RecordHeaderTask>
        {item.cover_status && (
          <PolicyPeriodLine>
            <span>Cover</span>
            <CoverStatus status={item.cover_status} />
          </PolicyPeriodLine>
        )}
        {item.money_status && (
          <MoneyRow>
            <span>Money</span>
            <MoneyStatus status={item.money_status} />
          </MoneyRow>
        )}
      </header>

      <Card className="flex flex-col gap-3">
        <CardTitle>Steps</CardTitle>
        {item.steps.length === 0 ? (
          <p className="text-sm text-ink-muted">No steps recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {item.steps.map((s) => (
              <li key={s.id} className="flex items-start gap-3 text-sm">
                <span aria-hidden className="mt-0.5 w-4 text-center">
                  {s.state === "done"
                    ? "✓"
                    : s.state === "now"
                      ? "●"
                      : s.state === "blocked"
                        ? "■"
                        : "○"}
                </span>
                <span className="flex-1">
                  <span
                    className={s.state === "now" ? "font-medium text-ink" : "text-ink-secondary"}
                  >
                    {s.label}
                  </span>
                  <span className="ml-2 text-ink-muted">{ACTOR_LABEL[s.actor]}</span>
                  {s.state === "blocked" && s.reason && (
                    <span className="ml-2 text-accent-red">Blocked — {s.reason}</span>
                  )}
                  {s.state === "done" && s.reason && (
                    <span className="ml-2 text-ink-muted">{s.reason}</span>
                  )}
                  {s.recorded.map((r) => (
                    <span key={r.recordedAt + r.reference} className="ml-2 text-ink-muted">
                      · {r.reference}
                    </span>
                  ))}
                  {(s.state === "now" || s.state === "blocked") && live && live.length > 0 && (
                    <ul
                      className="mt-1 flex flex-col gap-0.5 text-xs text-accent-green"
                      aria-live="polite"
                    >
                      {live.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {(s.state === "now" || s.state === "blocked") && actions && (
                    <div className="mt-2">{actions}</div>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        {item.exception && (
          <p className="text-sm text-ink">
            Closed as {item.exception.kind}: {item.exception.reason}
            {item.exception.clientToldEvidence
              ? ` (client told: ${item.exception.clientToldEvidence})`
              : ""}
          </p>
        )}
        <p className="text-xs text-ink-muted">
          ASAP prepares and drafts. Sending, approving and paying are recorded by a person, with
          evidence.
        </p>
      </Card>

      {runs.length > 0 && (
        <Card className="flex flex-col gap-3">
          <CardTitle>What ASAP did</CardTitle>
          <RunDetailSlot>
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <RunStatus status={r.status} />
                  <span className="text-ink">{r.title}</span>
                  {r.next_step && <span className="text-ink-secondary">— {r.next_step}</span>}
                </li>
              ))}
            </ul>
          </RunDetailSlot>
        </Card>
      )}
    </article>
  );
}

export function RunView({ run }: { run: RunRow }) {
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">{run.title}</h1>
      <RunDetailSlot>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <RunStatus status={run.status} />
          <span>Started {formatSince(run.started_at)}</span>
          {run.ended_at && <span>· ended {formatSince(run.ended_at)}</span>}
        </div>
      </RunDetailSlot>
      {run.next_step && <p className="text-sm text-ink">{run.next_step}</p>}
    </article>
  );
}
