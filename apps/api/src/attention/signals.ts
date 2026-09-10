import type {
  AttentionFact,
  AttentionPeriod,
  AttentionSignal,
  AttentionSignalId,
  RunRow,
  WorkItemRow,
} from "@asap/schema";

/**
 * Discover's ranking: deterministic, from rows, auditable.
 *
 * Architecture §27 asks for a weighted attention score. This is the first real one. Three rules
 * govern it, and every one of them is a rule about *who decides*:
 *
 *  1. **No model authors a score or a fact.** Each signal is computed here from columns the
 *     engine already writes. A model may later explain a ranked item; it may not rank one.
 *  2. **Every signal names its row.** `because` is built from the record — a guard id, a party
 *     name, a date — so a person can check the ranking against the record, and so can a test.
 *  3. **The weights are a fixed table, not a judgement.** They are here, in one place, in the
 *     open. Changing one is a code review, not a runtime surprise.
 *
 * The weights express four dimensions the brief asks for — urgency, financial impact, client
 * impact and risk — as a single ordering. They are ordinal, not units of anything: a failed run
 * outranks an unpaid premium because a person must act on it today, not because it is worth more.
 */
export const SIGNAL_POINTS: Readonly<Record<AttentionSignalId, number>> = {
  // Risk: something is wrong now and a person is the only one who can fix it.
  run_failed: 60,
  step_blocked: 55,
  // Urgency: a clock has run out, or is about to.
  check_overdue: 50,
  cover_uncertain: 48,
  period_ending: 40,
  file_blocks_placement: 38,
  exception_open: 34,
  // Evidence: we cannot answer honestly until this is resolved.
  evidence_conflicting: 32,
  evidence_missing: 24,
  evidence_stale: 18,
  // Financial: money is owed, in either direction.
  money_unpaid: 22,
  // Client impact: it has simply been sitting.
  untouched: 8,
};

/** Days after which recorded evidence is treated as stale. Not a legal value — a display rule. */
const STALE_AFTER_DAYS = 90;
/** Days before a period ends at which the ending starts to matter. */
const PERIOD_ENDING_WITHIN_DAYS = 45;
/** Days without an update after which an item is "untouched". */
const UNTOUCHED_AFTER_DAYS = 21;

const DAY = 86_400_000;
const daysBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / DAY);

/** The step a person or a party is waiting on. */
export function nowStepOf(item: WorkItemRow) {
  return item.steps.find((s) => s.state === "now" || s.state === "blocked") ?? null;
}

const guardId = (g: WorkItemRow["steps"][number]["guards"][number]): string =>
  typeof g === "string" ? g : g.id;

/**
 * Every fact behind an item, with how well it is known.
 *
 * `known` comes from evidence a person recorded. `missing` from a step that requires evidence and
 * has none. `waiting` from a step whose actor is an outside party. `stale` from a reference older
 * than the freshness the fact needs. `conflicting` from two recorded references on one step that
 * name different sources — the engine does not resolve them, and neither does this.
 * `inferred` is used only where a value is derived rather than recorded, and always says from what.
 */
export function factsFor(item: WorkItemRow, period: AttentionPeriod | null, now: Date): AttentionFact[] {
  const facts: AttentionFact[] = [];

  for (const step of item.steps) {
    for (const rec of step.recorded) {
      const age = rec.recordedAt ? daysBetween(new Date(rec.recordedAt), now) : null;
      facts.push({
        label: step.label,
        condition: age !== null && age > STALE_AFTER_DAYS ? "stale" : "known",
        reference: rec.reference,
        recordedBy: rec.recordedBy,
        recordedAt: rec.recordedAt,
        derivedFrom:
          age !== null && age > STALE_AFTER_DAYS ? `Recorded ${age} days ago` : null,
      });
    }
    // Two references on one step that disagree: both are shown, neither is chosen.
    if (step.recorded.length > 1) {
      const refs = [...new Set(step.recorded.map((r) => r.reference))];
      if (refs.length > 1) {
        facts.push({
          label: `${step.label} — sources disagree`,
          condition: "conflicting",
          reference: null,
          recordedBy: null,
          recordedAt: null,
          derivedFrom: refs.join(" vs "),
        });
      }
    }
    // A step that needs evidence and has none.
    if ((step.state === "now" || step.state === "blocked") && step.recorded.length === 0) {
      for (const req of step.evidence) {
        facts.push({
          label: req.label,
          condition: step.actor === "you" || step.actor === "asap" ? "missing" : "waiting",
          reference: null,
          recordedBy: null,
          recordedAt: null,
          derivedFrom:
            step.actor === "you" || step.actor === "asap"
              ? null
              : `${step.party ?? step.actor} has not answered`,
        });
      }
    }
  }

  // Cover: requested is not confirmed. This is the demo's central rule, as a fact condition.
  if (item.cover_status === "requested") {
    facts.push({
      label: "Cover for this period",
      condition: "waiting",
      reference: null,
      recordedBy: null,
      recordedAt: null,
      derivedFrom: "Requested. A request is not proof of cover; no insurer confirmation is recorded.",
    });
  }
  if (item.cover_status === "confirmed" && item.cover_inception_at) {
    facts.push({
      label: "Cover is active from the inception date",
      condition: "inferred",
      reference: null,
      recordedBy: null,
      recordedAt: item.cover_inception_at,
      derivedFrom: "Confirmed cover plus the recorded inception date",
    });
  }
  if (period && period.daysToEnd !== null) {
    facts.push({
      label: "Period of cover",
      condition: "known",
      reference: `${period.periodStart} to ${period.periodEnd}`,
      recordedBy: null,
      recordedAt: null,
      derivedFrom: null,
    });
  }
  return facts.slice(0, 12);
}

/**
 * Score one item. Returns at least one signal — an item with no signal does not belong on
 * Discover at all, and the caller drops it.
 */
export function signalsFor(input: {
  item: WorkItemRow;
  failedRun: RunRow | null;
  period: AttentionPeriod | null;
  clientFileBlocking: boolean;
  facts: AttentionFact[];
  now: Date;
}): AttentionSignal[] {
  const { item, failedRun, period, clientFileBlocking, facts, now } = input;
  const out: AttentionSignal[] = [];
  const add = (id: AttentionSignalId, because: string) =>
    out.push({ id, because, points: SIGNAL_POINTS[id] });

  const step = nowStepOf(item);

  if (failedRun) {
    add("run_failed", `${failedRun.title} could not finish: ${failedRun.next_step ?? "no next step recorded"}.`);
  }
  if (step?.state === "blocked") {
    const guards = step.guards.map(guardId).join(", ");
    add("step_blocked", `"${step.label}" is blocked${guards ? ` by ${guards}` : ""}.`);
  }
  if (item.task_status === "with_party" && item.task_next_check) {
    const overdue = daysBetween(new Date(item.task_next_check), now);
    if (overdue >= 0) {
      add(
        "check_overdue",
        `${item.task_party ?? "The other party"} was asked and the check was due ${
          overdue === 0 ? "today" : `${overdue} day${overdue === 1 ? "" : "s"} ago`
        }.`,
      );
    }
  }
  if (item.cover_status === "requested") {
    add("cover_uncertain", "Cover was requested and no insurer confirmation is recorded.");
  }
  if (clientFileBlocking) {
    add("file_blocks_placement", "The client's file is not cleared, and it is blocking this placement.");
  }
  if (period?.daysToEnd !== null && period !== null && period.daysToEnd! <= PERIOD_ENDING_WITHIN_DAYS) {
    const d = period.daysToEnd!;
    add(
      "period_ending",
      d < 0
        ? `The period of cover ended ${Math.abs(d)} days ago (${period.periodEnd}).`
        : `The period of cover ends in ${d} day${d === 1 ? "" : "s"} (${period.periodEnd}).`,
    );
  }
  if (item.money_status === "unpaid" || item.money_status === "part_paid") {
    add("money_unpaid", `Premium is recorded as ${item.money_status.replace(/_/g, " ")}.`);
  }
  if (item.exception) {
    add("exception_open", `Closed as ${item.exception.kind}: ${item.exception.reason}`);
  }
  const conflicting = facts.filter((f) => f.condition === "conflicting");
  if (conflicting.length > 0) {
    add("evidence_conflicting", `${conflicting.length} fact${conflicting.length === 1 ? "" : "s"} on this record has sources that disagree.`);
  }
  const missing = facts.filter((f) => f.condition === "missing");
  if (missing.length > 0) {
    add("evidence_missing", `${missing[0]!.label} is required here and is not on file.`);
  }
  const stale = facts.filter((f) => f.condition === "stale");
  if (stale.length > 0) {
    add("evidence_stale", `${stale[0]!.label} was last recorded more than ${STALE_AFTER_DAYS} days ago.`);
  }
  const idle = daysBetween(new Date(item.updated_at), now);
  if (idle >= UNTOUCHED_AFTER_DAYS && item.task_status !== "done") {
    add("untouched", `Nothing has happened on this for ${idle} days.`);
  }

  // Every item that reaches Discover has at least one reason. A needs-you item with no other
  // signal still has one: a person is the actor on its current step.
  if (out.length === 0 && item.task_status === "needs_you") {
    add(
      "evidence_missing",
      step ? `"${step.label}" is the step waiting on a person.` : "This item is waiting on a person.",
    );
  }
  return out;
}

export const scoreOf = (signals: AttentionSignal[]): number =>
  signals.reduce((n, s) => n + s.points, 0);

/**
 * The order two items appear in. Score first; then the older check, because a deadline that has
 * been missed longer is more urgent; then recency, so the ordering is total and stable.
 */
export function compareItems(
  a: { score: number; item: WorkItemRow },
  b: { score: number; item: WorkItemRow },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const ac = a.item.task_next_check, bc = b.item.task_next_check;
  if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;
  if (a.item.updated_at !== b.item.updated_at) return a.item.updated_at < b.item.updated_at ? 1 : -1;
  return a.item.id < b.item.id ? -1 : 1;
}

/** Days from the server's clock to a period end, or null when the date will not parse. */
export function daysToEnd(periodEnd: string, now: Date): number | null {
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  return Number.isNaN(end.getTime()) ? null : daysBetween(now, end);
}
