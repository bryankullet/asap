import type { SpaceBlock, SpacePlanResponse, SpaceView, WorkItemRow } from "@asap/schema";
import { Notice } from "@asap/ui";
import { useState } from "react";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { RecordFooter } from "../views/RecordFooter.js";
import { BLOCK_COMPONENTS, Suggestions } from "./blocks.js";

/**
 * The first Renewal Space (D-058, D-059), behind `VITE_PUBLIC_RENEWAL_SPACE`.
 *
 * It renders a validated plan and nothing else: the blocks come from the server in order, each
 * one looked up in the renderer's registry. A block the renderer does not know is skipped and
 * said out loud, never guessed at — the same rule the server applies against
 * `component_definitions`.
 *
 * A follow-up question changes the view, which changes the blocks. It does not navigate anywhere:
 * the record, and the client's context, stay put.
 */

/** The words a person types, mapped to the view that answers them. Deterministic; no model. */
const FOLLOW_UPS: { match: RegExp; view: SpaceView }[] = [
  { match: /\b(compare|comparison|terms side)\b/i, view: "comparison" },
  { match: /\b(why|increase|premium|difference)\b/i, view: "comparison" },
  { match: /\b(outstanding|missing|blocker|blocked|next step)\b/i, view: "blocker" },
  { match: /\b(policy|cover|schedule)\b/i, view: "policy" },
  { match: /\b(evidence|document|source)\b/i, view: "documents" },
  { match: /\b(activity|history|what has asap|timeline)\b/i, view: "timeline" },
];

export function viewForQuestion(q: string, fallback: SpaceView = "summary"): SpaceView {
  return FOLLOW_UPS.find((f) => f.match.test(q))?.view ?? fallback;
}

export function RenewalSpace({
  data,
  item,
  view,
  onView,
  onAct,
  acting = false,
  actError = null,
}: {
  data: SpacePlanResponse;
  /** The record itself, for the footer's evidence and Activity controls. */
  item: WorkItemRow;
  view: SpaceView;
  onView: (v: SpaceView) => void;
  onAct: (a: SpaceBlock["actions"][number]) => void;
  acting?: boolean;
  actError?: string | null;
}) {
  const [why, setWhy] = useState(false);
  const plan = data.plan;
  const unknown = plan.blocks.filter((b) => !BLOCK_COMPONENTS[b.component]);
  const hasRuns = plan.blocks.some((b) => b.component === "ActivityFeed");

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[clamp(1.7rem,3vw,2.4rem)] leading-tight font-semibold tracking-tight text-ink">
          {plan.title}
        </h1>
      </header>

      {plan.blocks.map((block, i) => {
        const Component = BLOCK_COMPONENTS[block.component];
        if (!Component) return null;
        return (
          <div key={`${block.component}-${i}`}>
            <Component
              block={block}
              onAct={block.actions.length > 0 ? onAct : undefined}
              onWhy={block.component === "RenewalReadiness" ? () => setWhy((v) => !v) : undefined}
            />
            {why && block.component === "RenewalReadiness" && (
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                {String((block.props as Record<string, unknown>)["why"] ?? "")}
              </p>
            )}
          </div>
        );
      })}

      {acting && <p className="text-sm text-ink-muted">Working on it…</p>}
      {actError && <Notice tone="error">{actError}</Notice>}

      {/* A block the server sent and this build cannot render. Said, never silently dropped. */}
      {unknown.length > 0 && (
        <Notice tone="info">
          {unknown.length === 1 ? "One part of this page" : `${unknown.length} parts of this page`}{" "}
          needs a newer version of the app: {unknown.map((b) => b.component).join(", ")}. Everything
          else here is current.
        </Notice>
      )}

      <Suggestions
        suggestions={plan.suggestions}
        onAsk={(q) => onView(viewForQuestion(q, view))}
      />

      <RecordFooter item={item} hasRuns={hasRuns} />
    </article>
  );
}

/** The states the Space owes before it has a plan (Part 10). */
export function SpaceStates({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: unknown;
  retry: () => void;
}) {
  if (pending) return <LoadingList rows={2} label="Composing this renewal" />;
  const status = (error as { status?: number } | null)?.status;
  if (status === 404)
    return (
      <MissingData
        what="No Space is composed for this record yet"
        why="Renewals are the first kind to move. Everything else opens as it did before."
      />
    );
  if (status === 422)
    return (
      <MissingData
        what="This page could not be composed"
        why="ASAP would not show a page it could not check. The record itself is unchanged and the failure is recorded for us to look at."
      />
    );
  return <ErrorState what="This renewal could not load" retry={retry} />;
}
