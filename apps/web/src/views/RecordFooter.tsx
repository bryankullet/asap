import type { WorkItemRow } from "@asap/schema";
import { Button } from "@asap/ui";
import { useState } from "react";

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
        <span
          className="px-3 py-1.5 text-[0.86rem] font-semibold text-ink-muted"
          title="The full audit history arrives with the audit screen (C05)."
        >
          History
        </span>
      </div>
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
