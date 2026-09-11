import type { RunDetailResponse } from "@asap/schema";
import { Button, Card, CardTitle, Timeline, TimelineEvent } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { RunDetailSlot, RunStatus, formatSince } from "../components/status/slots.js";

/**
 * One run, in full — the prototype's "Jobs" detail, built where Screen Map v3 puts runs: reached
 * from the Activity chip and from a record, never from a fourth navigation item.
 *
 * The separation this view exists to hold: **a run is what ASAP is doing; Work is what a person
 * owns; insurance status is what is true of the business.** A finished run means ASAP produced
 * its output. It never means a policy was renewed, cover was confirmed, a claim was accepted or
 * money was received. So the run's own words sit in the run slot, and the only way to a business
 * outcome from here is the link to the work a person owns.
 */
export function RunDetail({ data }: { data: RunDetailResponse }) {
  const { run, events, relatedWork, evidence, waitingFor, recovery } = data;
  const unfinished = run.status === "could_not_finish" || run.status === "stopped";

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[clamp(1.5rem,3vw,2rem)] leading-tight font-semibold tracking-tight text-ink">
          {run.title}
        </h1>
        <RunDetailSlot>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <RunStatus status={run.status} />
            <span>Started {formatSince(run.started_at)}</span>
            {run.ended_at && <span>· ended {formatSince(run.ended_at)}</span>}
          </div>
        </RunDetailSlot>
        <p className="text-sm text-ink-muted">
          This is what ASAP did. What it means for the business is on the work below — a run
          finishing is never, on its own, a renewal, a confirmation, an acceptance or a payment.
        </p>
      </header>

      {waitingFor && (
        <Card
          variant={unfinished ? "attention" : "quiet"}
          className="flex flex-col gap-1 border-l-4 border-l-accent-gold"
        >
          <CardTitle>{unfinished ? "It could not finish" : "What it is waiting for"}</CardTitle>
          <p className="text-sm text-ink-secondary">{waitingFor}</p>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <CardTitle>Step by step</CardTitle>
        {events.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No steps were recorded before this run ended.
          </p>
        ) : (
          <Timeline>
            {events.map((e) => (
              <TimelineEvent
                key={e.id}
                current={e.kind === "step" && e.seq === events[events.length - 1]?.seq}
                title={e.message}
                when={<span className="text-xs text-ink-muted">{formatSince(e.created_at)}</span>}
              />
            ))}
          </Timeline>
        )}
      </Card>

      {evidence.length > 0 && (
        <Card className="flex flex-col gap-2">
          <CardTitle>Evidence on the record</CardTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {evidence.map((e, i) => (
              <li key={`${e.reference}-${i}`} className="text-ink-secondary">
                <span className="text-ink">{e.label}</span> — {e.reference}
                {e.recordedBy && <span className="text-ink-muted"> · {e.recordedBy}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card variant="quiet" className="flex flex-col gap-3">
        <CardTitle>The work this belongs to</CardTitle>
        {relatedWork ? (
          <>
            <p className="text-sm">
              <Link
                to="/r/$recordId"
                params={{ recordId: relatedWork.id }}
                className="font-semibold text-ink hover:underline"
              >
                {relatedWork.title}
              </Link>
              {relatedWork.nowStep && (
                <span className="text-ink-muted"> · now: {relatedWork.nowStep}</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {recovery.map((r) =>
                r.kind === "open_work" && r.disabledReason === null ? (
                  <Link
                    key={r.kind}
                    to="/r/$recordId"
                    params={{ recordId: relatedWork.id }}
                    className="rounded-compact border border-line-strong px-3 py-1.5 text-[0.86rem] font-semibold text-ink hover:bg-wash"
                  >
                    {r.label}
                  </Link>
                ) : (
                  // Offered, disabled, with its reason — never hidden (section 34).
                  <Button
                    key={r.kind}
                    variant="outline"
                    size="compact"
                    disabled
                    title={r.disabledReason ?? undefined}
                  >
                    {r.label}
                  </Button>
                ),
              )}
            </div>
            {recovery
              .filter((r) => r.disabledReason !== null)
              .map((r) => (
                <p key={r.kind} className="text-sm text-ink-muted">
                  {r.label}: {r.disabledReason}
                </p>
              ))}
          </>
        ) : (
          <p className="text-sm text-ink-secondary">
            This run has no work item of its own. That is why it appears on Discover — a run must
            never be the only place something important lives.
          </p>
        )}
      </Card>
    </article>
  );
}
