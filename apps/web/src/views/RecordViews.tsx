import {
  RECORD_SECTIONS,
  currentStep,
  effectiveCoverStatus,
  focusCard,
  type RunRow,
  type WorkItemRow,
} from "@asap/schema";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card, CardTitle, Timeline, TimelineEvent } from "@asap/ui";
import { FocusCard } from "./FocusCard.js";
import { RECORD_ACTIVITY_ID, RecordFooter } from "./RecordFooter.js";
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
  aside = null,
  drafts = null,
}: {
  item: WorkItemRow;
  runs: RunRow[];
  /** The current step's actions, supplied by the page so the view stays pure. */
  actions?: ReactNode;
  /** Messages from a run in progress, streamed. */
  live?: string[] | null;
  /** The record behind the item (claim, endorsement): the "servicing" section of the recipe. */
  aside?: ReactNode;
  /** Drafts prepared for the current step: the "drafts" section of the recipe. */
  drafts?: ReactNode;
}) {
  const step = currentStep(item);
  const focus = focusCard(item, step);
  const sections = RECORD_SECTIONS[item.kind];
  const stepsSection = (
    <Card className="flex flex-col gap-3">
      <CardTitle>Every step</CardTitle>
      {item.steps.length === 0 ? (
        <p className="text-sm text-ink-muted">No steps recorded yet.</p>
      ) : (
        <ol className="flex flex-col">
          {item.steps.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 border-b border-line-soft py-2.5 text-sm last:border-b-0"
            >
              <span
                aria-hidden
                className={
                  "mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-xs font-bold " +
                  (s.state === "done"
                    ? "bg-accent-green-soft text-accent-green"
                    : s.state === "now"
                      ? "bg-accent-gold-soft text-accent-gold-ink"
                      : s.state === "blocked"
                        ? "bg-accent-red-soft text-accent-red"
                        : "bg-surface-sunken text-ink-muted")
                }
              >
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
                  className={s.state === "now" ? "font-semibold text-ink" : "text-ink-secondary"}
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
  );

  const activitySection =
    runs.length > 0 ? (
      // The record footer's Activity control targets this id. It pointed at nothing before.
      <Card id={RECORD_ACTIVITY_ID} tabIndex={-1} className="flex flex-col gap-3">
        <CardTitle>What ASAP did</CardTitle>
        <RunDetailSlot>
          <Timeline>
            {runs.map((r) => (
              <TimelineEvent
                key={r.id}
                current={r.status === "working"}
                title={r.title}
                when={<RunStatus status={r.status} />}
              >
                {r.next_step && <p className="mt-1 text-sm text-ink-secondary">{r.next_step}</p>}
              </TimelineEvent>
            ))}
          </Timeline>
        </RunDetailSlot>
      </Card>
    ) : null;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[clamp(1.7rem,3vw,2.4rem)] leading-tight font-semibold tracking-tight text-ink">
          {item.title}
        </h1>
        {item.client_id && (
          <Link
            to="/files/$clientId"
            params={{ clientId: item.client_id }}
            className="text-sm font-bold text-accent-green underline underline-offset-2"
          >
            Client file
          </Link>
        )}
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
            <CoverStatus status={effectiveCoverStatus(item) ?? item.cover_status} />
          </PolicyPeriodLine>
        )}
        {item.money_status && (
          <MoneyRow>
            <span>Money</span>
            <MoneyStatus status={item.money_status} />
          </MoneyRow>
        )}
      </header>

      {/* Part 14: every record page leads with the next decision. */}
      <FocusCard card={focus} item={item} actions={actions} />
      {live && live.length > 0 && (
        <ul
          className="flex flex-col gap-1 rounded-card border border-accent-green/20 bg-accent-green-soft px-4 py-3 text-sm text-accent-green-ink"
          aria-live="polite"
        >
          {live.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      {/* Part 14: the rest is composed by kind, and a section renders only if it has content. */}
      {sections.map((section) => {
        switch (section) {
          case "focus":
            return null;
          case "servicing":
            return aside ? <div key={section}>{aside}</div> : null;
          case "drafts":
            return drafts ? <div key={section}>{drafts}</div> : null;
          case "steps":
            return <div key={section}>{stepsSection}</div>;
          case "activity":
            return activitySection ? <div key={section}>{activitySection}</div> : null;
        }
      })}

      <RecordFooter item={item} hasRuns={runs.length > 0} />
    </article>
  );
}
