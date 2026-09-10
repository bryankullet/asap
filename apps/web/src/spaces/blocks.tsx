import type { SpaceBlock } from "@asap/schema";
import { Badge, Button, Card, CardTitle, Checklist, ChecklistRow, Table, TD, TH, Timeline, TimelineEvent } from "@asap/ui";
import type { ReactNode } from "react";
import {
  CoverStatus,
  PolicyPeriodLine,
  RecordHeaderTask,
  RunDetailSlot,
  RunStatus,
  TaskStatus,
  formatSince,
} from "../components/status/slots.js";

/**
 * The registry's React side: one component per `component_definitions` row, keyed by its id.
 *
 * Props arrive already validated against the stored JSON Schema, server-side, so these components
 * render what they are given and do not re-derive business facts. Visual reference is the v4
 * prototype (`docs/ui/prototype/dist/`): hairline cards, the green-left focus panel, plain rows
 * of facts, `source(...)` beneath a fact. None of the prototype's data or code is used.
 */

/** Evidence beneath a fact — the prototype's `source(...)`, with our own recorded references. */
function Sources({ evidence }: { evidence: SpaceBlock["evidence"] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
      {evidence.map((e, i) => (
        <li key={`${e.reference}-${i}`} className="text-[0.8125rem] text-ink-muted">
          <span aria-hidden>▤</span> {e.label} — <span className="text-ink-secondary">{e.reference}</span>
          {e.recordedBy ? ` · ${e.recordedBy}` : ""}
          {e.recordedAt ? ` · ${formatSince(e.recordedAt)}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** The block's actions, exactly as the plan carries them. A blocked one is disabled with its reason. */
function Actions({
  actions,
  onAct,
}: {
  actions: SpaceBlock["actions"];
  onAct?: ((a: SpaceBlock["actions"][number]) => void) | undefined;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={`${a.stepId}:${a.verb}`}
          variant={a.verb === "prepare" || a.verb === "record_evidence" ? "green" : "outline"}
          size="compact"
          disabled={a.disabledReason !== null}
          title={a.disabledReason ?? undefined}
          onClick={() => onAct?.(a)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

type P = Record<string, unknown>;
const str = (p: P, k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");
const strOrNull = (p: P, k: string): string | null =>
  typeof p[k] === "string" ? (p[k] as string) : null;
const list = <T,>(p: P, k: string): T[] => (Array.isArray(p[k]) ? (p[k] as T[]) : []);

export type BlockProps = {
  block: SpaceBlock;
  onAct?: ((a: SpaceBlock["actions"][number]) => void) | undefined;
  /** Discloses the plan's own reason, the way "Why here?" does on a card. */
  onWhy?: (() => void) | undefined;
};

/** The focus block. Styled like the prototype's `.focus-card`: hairline, 4px green left border. */
function RenewalReadiness({ block, onAct, onWhy }: BlockProps) {
  const p = block.props as P;
  const ready = list<string>(p, "ready");
  const outstanding = list<string>(p, "outstanding");
  const blockedBy = strOrNull(p, "blockedBy");
  return (
    <Card variant="focus" className="flex flex-col gap-3">
      <p className="text-[0.72rem] font-bold tracking-[0.14em] text-ink-muted uppercase">
        {str(p, "eyebrow")}
      </p>
      <h2 className="font-heading text-[1.45rem] leading-snug font-semibold tracking-tight text-ink">
        {str(p, "headline")}
      </h2>
      <p className="text-[0.95rem] leading-relaxed text-ink-secondary">{str(p, "why")}</p>
      {blockedBy && (
        <p className="rounded-card border border-accent-gold/25 bg-accent-gold-soft px-3 py-2 text-sm text-accent-gold-ink">
          <strong>Not yet:</strong> {blockedBy}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Actions actions={block.actions} onAct={onAct} />
        {onWhy && (
          <Button variant="ghost" size="compact" onClick={onWhy}>
            Why here?
          </Button>
        )}
      </div>
      {(ready.length > 0 || outstanding.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-ink-secondary">
            What is done, and what is not
          </summary>
          <Checklist className="mt-2">
            {ready.map((r) => (
              <ChecklistRow key={r} done title={r} />
            ))}
            {outstanding.map((r) => (
              <ChecklistRow key={r} title={r} />
            ))}
          </Checklist>
        </details>
      )}
    </Card>
  );
}

function ClientHeader({ block }: BlockProps) {
  const p = block.props as P;
  return (
    <Card variant="quiet" className="flex flex-col gap-2">
      <CardTitle>{str(p, "clientName")}</CardTitle>
      <RecordHeaderTask>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <TaskStatus
            status={str(p, "taskStatus") as "needs_you" | "with_party" | "in_progress" | "done"}
            party={strOrNull(p, "taskParty")}
            since={strOrNull(p, "taskSince")}
          />
        </div>
      </RecordHeaderTask>
      {strOrNull(p, "fileStatus") && (
        <p className="text-sm text-ink-muted">
          Client file: <span className="text-ink-secondary">{str(p, "fileStatus").replace(/_/g, " ")}</span>
        </p>
      )}
    </Card>
  );
}

function PolicyCard({ block }: BlockProps) {
  const p = block.props as P;
  const cover = strOrNull(p, "coverStatus");
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Current cover period</CardTitle>
      <div className="flex flex-col gap-1.5 text-sm">
        <Row label={str(p, "classOfBusiness")} value={`with ${str(p, "insurerName")}`} />
        {strOrNull(p, "policyNumber") && <Row label="Policy number" value={str(p, "policyNumber")} />}
        <Row label="Period" value={`${str(p, "periodStart")} to ${str(p, "periodEnd")}`} />
      </div>
      {cover && (
        <PolicyPeriodLine>
          <span>Cover</span>
          <CoverStatus
            status={
              cover as "draft" | "requested" | "submitted" | "confirmed" | "active" | "expired" | "cancelled"
            }
          />
        </PolicyPeriodLine>
      )}
      <Sources evidence={block.evidence} />
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-1.5 last:border-b-0">
      <span className="text-ink-secondary">{label}</span>
      <strong className="text-right font-semibold text-ink">{value}</strong>
    </div>
  );
}

const TRACKER_LABEL: Record<string, string> = {
  on_file: "On file",
  not_on_file: "Not on file",
  declined: "Declined",
};

function InsurerResponseTracker({ block }: BlockProps) {
  const insurers = list<{ name: string; state: string; reference: string | null; recordedAt: string | null }>(
    block.props as P,
    "insurers",
  );
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Insurer terms</CardTitle>
      <div className="flex flex-col gap-1.5 text-sm">
        {insurers.map((i) => (
          <Row
            key={i.name}
            label={i.name}
            value={
              <>
                {TRACKER_LABEL[i.state] ?? i.state}
                {i.recordedAt ? ` · ${formatSince(i.recordedAt)}` : ""}
              </>
            }
          />
        ))}
      </div>
      <Sources evidence={block.evidence} />
    </Card>
  );
}

function TermComparison({ block }: BlockProps) {
  const p = block.props as P;
  const rows = list<{ fact: string; values: { insurerName: string; value: string }[] }>(p, "rows");
  const insurers = [...new Set(rows.flatMap((r) => r.values.map((v) => v.insurerName)))];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Compare the terms</CardTitle>
      <Table>
          <thead>
            <tr>
              <TH>Fact</TH>
              {insurers.map((i) => (
                <TH key={i}>{i}</TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fact}>
                <TD>{r.fact}</TD>
                {insurers.map((i) => (
                  <TD key={i}>{r.values.find((v) => v.insurerName === i)?.value ?? "—"}</TD>
                ))}
              </tr>
            ))}
          </tbody>
      </Table>
      {strOrNull(p, "note") && <p className="text-sm text-ink-muted">{str(p, "note")}</p>}
      <Sources evidence={block.evidence} />
    </Card>
  );
}

function DraftEmail({ block, onAct }: BlockProps) {
  const p = block.props as P;
  const sentAt = strOrNull(p, "sentAt");
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Prepared for you</CardTitle>
        {/* Copying is not sending. A send exists only once a person recorded it with evidence. */}
        <Badge tone={sentAt ? "active" : "neutral"}>
          {sentAt ? "You recorded this as sent" : "Draft — you send it"}
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <Row label="To" value={str(p, "to")} />
        <Row label="Subject" value={str(p, "subject")} />
      </div>
      <p className="rounded-card border border-line-soft bg-wash px-3 py-2.5 text-sm whitespace-pre-line text-ink-secondary">
        {str(p, "body")}
      </p>
      {strOrNull(p, "sentEvidence") && (
        <p className="text-sm text-ink-muted">Recorded as sent: {str(p, "sentEvidence")}</p>
      )}
      <Actions actions={block.actions} onAct={onAct} />
    </Card>
  );
}

function SourceEvidence({ block }: BlockProps) {
  const items = list<{ label: string; reference: string; recordedBy: string | null; recordedAt: string | null }>(
    block.props as P,
    "items",
  );
  return (
    <Card variant="quiet" className="flex flex-col gap-3">
      <CardTitle>Evidence on record</CardTitle>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((i, n) => (
          <li key={`${i.reference}-${n}`} className="text-ink-secondary">
            <span className="text-ink">{i.label}</span> — {i.reference}
            {i.recordedBy ? <span className="text-ink-muted"> · {i.recordedBy}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityFeed({ block }: BlockProps) {
  const p = block.props as P;
  const runs = list<{
    title: string;
    status: "working" | "paused" | "finished" | "could_not_finish" | "stopped";
    nextStep: string | null;
    startedAt: string;
    endedAt: string | null;
  }>(p, "runs");
  const recorded = list<{ label: string; reference: string; recordedBy: string | null }>(p, "recorded");
  return (
    <Card id="record-activity" tabIndex={-1} className="flex flex-col gap-3">
      <CardTitle>What ASAP did</CardTitle>
      <RunDetailSlot>
        <Timeline>
          {runs.map((r) => (
            <TimelineEvent
              key={`${r.title}-${r.startedAt}`}
              current={r.status === "working"}
              title={r.title}
              when={<RunStatus status={r.status} />}
            >
              {r.nextStep && <p className="mt-1 text-sm text-ink-secondary">{r.nextStep}</p>}
            </TimelineEvent>
          ))}
        </Timeline>
      </RunDetailSlot>
      {recorded.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line-soft pt-2.5 text-sm">
          {recorded.map((r, i) => (
            <li key={`${r.reference}-${i}`} className="text-ink-secondary">
              <span className="text-ink">{r.label}</span> — {r.reference}
              {r.recordedBy ? <span className="text-ink-muted"> · {r.recordedBy}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The mark in the square: the same glyphs the record page's step list uses. */
const STEP_MARK: Record<string, string> = { done: "✓", now: "●", blocked: "■", todo: "○" };

function ChecklistBlock({ block }: BlockProps) {
  const items = list<{ label: string; state: string; actor: string; note: string | null }>(
    block.props as P,
    "items",
  );
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Every step</CardTitle>
      <Checklist>
        {items.map((i) => (
          <ChecklistRow
            key={i.label}
            done={i.state === "done"}
            mark={STEP_MARK[i.state] ?? "○"}
            title={i.label}
            detail={i.note ? `${i.actor} · ${i.note}` : i.actor}
          />
        ))}
      </Checklist>
    </Card>
  );
}

/**
 * The renderer's lookup. A component id that is not a key here does not render — the same rule the
 * server enforces against `component_definitions`, on this side of the wire.
 */
export const BLOCK_COMPONENTS: Record<string, (props: BlockProps) => ReactNode> = {
  RenewalReadiness,
  ClientHeader,
  PolicyCard,
  InsurerResponseTracker,
  TermComparison,
  DraftEmail,
  SourceEvidence,
  ActivityFeed,
  Checklist: ChecklistBlock,
};

/** The follow-up questions the plan suggested, as words a person can click. */
export function Suggestions({
  suggestions,
  onAsk,
}: {
  suggestions: string[];
  onAsk: (q: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">Ask next:</span>
      {suggestions.map((s) => (
        <Button key={s} variant="soft" size="compact" onClick={() => onAsk(s)}>
          {s}
        </Button>
      ))}
    </div>
  );
}

