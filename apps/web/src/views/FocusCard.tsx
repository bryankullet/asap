import type { FocusCard as FocusCardData, WorkItemRow } from "@asap/schema";
import { Button, Card } from "@asap/ui";
import { useState, type ReactNode } from "react";
import { formatSince } from "../components/status/slots.js";

/**
 * The one panel a record page leads with (UI Build Spec v1 Part 14): a "Next step" eyebrow, the
 * decision in business words, one sentence of why, the step's actions, and "Why here?" beside
 * them. Everything is derived from the step and guard state the engine already wrote.
 */
export function FocusCard({
  card,
  item,
  actions = null,
}: {
  card: FocusCardData;
  item: WorkItemRow;
  /** The current step's actions, supplied by the page so the view stays pure. */
  actions?: ReactNode;
}) {
  const [why, setWhy] = useState(false);
  const recorded = item.steps.flatMap((s) => s.recorded);
  return (
    <Card variant="focus" className="flex flex-col gap-2">
      <p className="text-xs font-bold tracking-[0.1em] text-accent-green uppercase">
        {card.eyebrow}
      </p>
      <h2 className="font-heading text-[1.45rem] leading-snug font-semibold tracking-tight text-ink">
        {card.headline}
      </h2>
      <p className="text-ink-muted">{card.why}</p>
      {card.blockedBy && card.blockedBy !== card.why && (
        <p className="text-sm text-accent-gold-ink">{card.blockedBy}</p>
      )}
      <div className="mt-2 flex flex-wrap items-start gap-2">
        {actions}
        <Button variant="ghost" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          Why here?
        </Button>
      </div>
      {why && (
        <div className="mt-1 flex flex-col gap-1 border-t border-line-soft pt-3 text-sm">
          <p className="text-ink-secondary">{item.reason ?? card.why}</p>
          {item.task_party && (
            <p className="text-ink-muted">
              With {item.task_party}
              {item.task_next_check ? `, next check ${formatSince(item.task_next_check)}` : ""}.
            </p>
          )}
          <p className="text-ink-muted">
            {recorded.length > 0
              ? `Evidence on record: ${recorded.map((r) => r.reference).join("; ")}.`
              : "Nothing has been recorded against this record yet."}
          </p>
        </div>
      )}
    </Card>
  );
}
