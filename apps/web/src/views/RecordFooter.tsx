import type { WorkItemRow } from "@asap/schema";
import { Button, Card } from "@asap/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiRequestError, describeApiError } from "../lib/api.js";
import { formatSince } from "../components/status/slots.js";

/** The id of the run history on a record page. The footer's Activity control targets it. */
export const RECORD_ACTIVITY_ID = "record-activity";

/**
 * The record footer (UI Build Spec v1 Part 14): the source chip, Activity and History. The source
 * chip lists what has actually been recorded against the record; Activity jumps to what ASAP did
 * on this page. The audit history is C05 and is not built, so it says so rather than offering a
 * control that goes nowhere.
 */
export function RecordFooter({ item, hasRuns }: { item: WorkItemRow; hasRuns: boolean }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const recorded = item.steps.flatMap((s) => s.recorded.map((r) => ({ ...r, step: s.label })));
  return (
    <footer className="mt-6 flex flex-col gap-3 border-t border-line-soft pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="compact"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden>▤</span>
          {recorded.length > 0 ? `Evidence on record (${recorded.length})` : "Evidence on record"}
        </Button>
        {hasRuns ? (
          <Button
            variant="outline"
            size="compact"
            onClick={() => {
              // Scroll and move focus, so a keyboard user lands on the section too. This was an
              // <a href="#record-activity"> pointing at an id that no element carried.
              const el = document.getElementById(RECORD_ACTIVITY_ID);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
              el?.focus({ preventScroll: true });
            }}
          >
            Activity
          </Button>
        ) : (
          <span className="px-3 py-1.5 text-[0.86rem] font-semibold text-ink-muted">
            No runs on this record yet
          </span>
        )}
        <Button
          variant="outline"
          size="compact"
          aria-expanded={history}
          onClick={() => setHistory((v) => !v)}
        >
          History
        </Button>
      </div>
      {history && <RecordHistory recordId={item.id} />}
      {open && (
        <ul className="flex flex-col gap-1 text-sm">
          {recorded.length === 0 && (
            <li className="text-ink-muted">Nothing has been recorded against this record yet.</li>
          )}
          {recorded.map((r) => (
            <li key={r.recordedAt + r.reference} className="text-ink-secondary">
              <span className="text-ink">{r.step}</span> — {r.reference}
              <span className="text-ink-muted"> · {r.recordedBy}</span>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}

/**
 * The record's audit history (C05: never rewrite historical outcomes).
 *
 * Every state this owes is here: loading, a role without `audit:view` told so by name, an error
 * with a way back, and an empty history that says the record is new rather than that nothing
 * happened. A denial is history too and is shown, not hidden.
 */
function RecordHistory({ recordId }: { recordId: string }) {
  const q = useQuery({
    queryKey: ["history", recordId],
    queryFn: () => api.history(recordId),
    retry: false,
  });

  if (q.isPending) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Loading the history…
      </p>
    );
  }
  if (q.isError) {
    const err = q.error;
    if (err instanceof ApiRequestError && err.status === 403) {
      return (
        <Card variant="quiet" role="status" className="text-sm text-ink-secondary">
          The audit history is not available to your role. Nothing is hidden without saying so.
        </Card>
      );
    }
    return (
      <Card role="alert" className="flex flex-col gap-2 border-l-4 border-l-accent-red text-sm">
        <span className="text-ink">The history could not load. {describeApiError(err)}</span>
        <button
          type="button"
          className="self-start font-bold text-accent-green underline underline-offset-2"
          onClick={() => void q.refetch()}
        >
          Try again
        </button>
      </Card>
    );
  }
  if (q.data.entries.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Nothing has been recorded against this record yet. History begins at its first action.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {q.data.entries.map((e) => (
        <li key={e.id} className="border-b border-line-soft pb-2 last:border-b-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-ink">{e.action}</span>
            <span className="text-ink-muted">
              {e.actorName ?? (e.actorType === "user" ? "a person" : e.actorType)}
            </span>
            <span className="text-ink-muted">· {formatSince(e.occurredAt)}</span>
            {e.result !== "success" && (
              <span className="font-semibold text-accent-red">
                {e.result === "denied" ? "Denied" : "Did not succeed"}
                {e.failureReason ? `: ${e.failureReason}` : ""}
              </span>
            )}
          </div>
          {e.changed.length > 0 && (
            <p className="text-ink-secondary">{e.changed.join(" · ")}</p>
          )}
          {e.evidence.length > 0 && (
            <p className="text-ink-muted">
              <span aria-hidden>▤</span> {e.evidence.join(" · ")}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
