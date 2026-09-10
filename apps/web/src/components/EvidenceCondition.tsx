import { EVIDENCE_CONDITION_LABELS, type AttentionFact, type EvidenceCondition } from "@asap/schema";
import { cn } from "@asap/ui";

/**
 * How well a fact is known: Known, Inferred, Conflicting, Missing, Stale, Waiting for verification.
 *
 * These are the sixth vocabulary in the product and they describe *evidence*, never a task, a run,
 * cover or money. They therefore have their own slot — beside a fact — and share no word with the
 * four status layers (`packages/schema/src/status.ts`). "Waiting for verification" is written in
 * full precisely so it is never read as the banned bare "Waiting".
 *
 * Colour follows the fixed semantics: green = settled, gold = attention, red = needs review,
 * grey = neither. It is never re-mapped per screen.
 */
const TONE: Record<EvidenceCondition, string> = {
  known: "bg-accent-green-soft text-accent-green-ink",
  inferred: "bg-surface-sunken text-ink-secondary",
  conflicting: "bg-accent-red-soft text-accent-red-ink",
  missing: "bg-accent-red-soft text-accent-red-ink",
  stale: "bg-accent-gold-soft text-accent-gold-ink",
  waiting: "bg-accent-gold-soft text-accent-gold-ink",
};

const DOT: Record<EvidenceCondition, string> = {
  known: "bg-accent-green",
  inferred: "bg-dot-neutral",
  conflicting: "bg-accent-red",
  missing: "bg-accent-red",
  stale: "bg-accent-gold",
  waiting: "bg-accent-gold",
};

export function EvidenceConditionChip({
  condition,
  className,
}: {
  condition: EvidenceCondition;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2 py-0.5 text-[0.72rem] font-bold",
        TONE[condition],
        className,
      )}
    >
      <span aria-hidden className={cn("h-[6px] w-[6px] rounded-full", DOT[condition])} />
      {EVIDENCE_CONDITION_LABELS[condition]}
    </span>
  );
}

/**
 * The facts behind an item. A missing fact is stated as missing; an inferred one says what it was
 * derived from; a conflicting one shows both sources and resolves neither.
 */
export function FactList({ facts }: { facts: AttentionFact[] }) {
  if (facts.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing has been recorded against this record yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {facts.map((f, i) => (
        <li key={`${f.label}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <EvidenceConditionChip condition={f.condition} />
          <span className="text-ink">{f.label}</span>
          {f.reference && <span className="text-ink-secondary">— {f.reference}</span>}
          {f.derivedFrom && <span className="text-ink-muted">({f.derivedFrom})</span>}
          {f.recordedBy && <span className="text-ink-muted">· {f.recordedBy}</span>}
        </li>
      ))}
    </ul>
  );
}
