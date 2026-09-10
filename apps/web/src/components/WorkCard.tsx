import type { WorkItemRow } from "@asap/schema";
import { Card } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  CardHeadline,
  CoverStatus,
  MoneyRow,
  MoneyStatus,
  PolicyPeriodLine,
  TaskStatus,
  WorkCardSlot,
} from "./status/slots.js";

/**
 * A work item on Today and in Work. The headline carries the task status only; cover and money
 * sit on their own lines. Compliance and stock never reach this card (Part 2.4).
 */
export function WorkCard({
  item,
  showWhy = false,
  footer,
  reason,
  nowStep,
  context,
}: {
  item: WorkItemRow;
  showWhy?: boolean;
  footer?: ReactNode;
  /** Client and period of cover, when policy context matters (Architecture section 3A). */
  context?: ReactNode;
  /** The reason the API gave for this item appearing. Falls back to the row's own. */
  reason?: string;
  /** The step the API named as waiting, so the card need not re-derive it. */
  nowStep?: { label: string; actor: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const now = nowStep ?? item.steps.find((s) => s.state === "now") ?? null;
  const why = reason ?? item.reason;
  return (
    <WorkCardSlot>
      <Card data-testid="work-card" className="flex flex-col gap-3">
        <CardHeadline>
          <TaskStatus status={item.task_status} party={item.task_party} since={item.task_since} />
          <h3 className="font-heading text-[1.15rem] leading-snug font-semibold tracking-tight text-ink">
            <Link to="/r/$recordId" params={{ recordId: item.id }} className="hover:underline">
              {item.title}
            </Link>
          </h3>
        </CardHeadline>
        {context}
        {now && (
          <p className="text-sm text-ink-secondary">
            Now: {now.label}{" "}
            <span className="text-ink-muted">
              ({now.actor === "you" ? "you" : now.actor === "asap" ? "ASAP" : now.actor})
            </span>
          </p>
        )}
        {(item.cover_status || item.money_status) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft pt-3">
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
          </div>
        )}
        {showWhy && why && (
          <div>
            <button
              type="button"
              className="text-sm font-bold text-accent-green underline underline-offset-2"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              Why here?
            </button>
            {open && <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{why}</p>}
          </div>
        )}
        {footer}
      </Card>
    </WorkCardSlot>
  );
}
