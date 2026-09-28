import type { PolicyCover, PolicyCoverState, PolicyEvidence } from "@asap/schema";

/**
 * Cover state for a policy and its periods (4C-1) — pure, so every rule is tested on its own.
 *
 * "Active cover" needs evidence that cover was confirmed or activated: an insurer's confirmation
 * reached through an issued-policy application, or a reviewed issued-policy document applied to
 * the period. Dates alone never make cover. The rules, all in the Africa/Nairobi calendar:
 *
 *   no evidence                          no cover state — "Cover not verified"
 *   explicit cancellation, in effect     Cancelled
 *   evidence, begins after today         Confirmed (not started)
 *   evidence, today within the period    Active cover
 *   evidence, ended before today         Expired
 *
 * For the policy as a whole: two periods that both cover today are a conflict and neither is
 * chosen; otherwise the period covering today decides; with none, a verified upcoming period is
 * Confirmed; otherwise the latest period decides — Expired only if it was verified.
 */

export type PeriodEvidence = {
  id: string;
  start: string; // YYYY-MM-DD, first day of cover
  end: string; // YYYY-MM-DD, last day of cover
  evidence: PolicyEvidence[];
  verified: boolean;
  /** An explicit, evidenced cancellation, with the moment it takes effect. */
  cancellation: { at: string; evidence: PolicyEvidence } | null;
};

const NAIROBI = "Africa/Nairobi";

/** The calendar day in Nairobi at an instant. */
export function nairobiDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NAIROBI, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const COVER_WORDS: Record<PolicyCoverState, string> = {
  requested: "Requested",
  submitted: "Submitted",
  confirmed: "Confirmed",
  active: "Active cover",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function periodCover(p: PeriodEvidence, today: string): PolicyCover {
  const range = `${pretty(p.start)} to ${pretty(p.end)}`;
  if (p.cancellation !== null && nairobiDay(new Date(p.cancellation.at)) <= today) {
    return {
      state: "cancelled", label: COVER_WORDS.cancelled, verified: p.verified, asOf: today,
      reason: `Cancelled with effect from ${pretty(nairobiDay(new Date(p.cancellation.at)))}, on recorded evidence.`,
      evidence: [p.cancellation.evidence, ...p.evidence].slice(0, 10),
    };
  }
  if (!p.verified) {
    return {
      state: null, label: "Cover not verified", verified: false, asOf: today, evidence: [],
      reason: `The period ${range} is on file, but nothing on file confirms the insurer put it on cover: no insurer confirmation and no reviewed policy document. Dates alone are not cover.`,
    };
  }
  if (p.start > today) {
    return { state: "confirmed", label: COVER_WORDS.confirmed, verified: true, asOf: today, evidence: p.evidence, reason: `Confirmed on evidence, beginning ${pretty(p.start)}. It has not started yet.` };
  }
  if (p.end < today) {
    return { state: "expired", label: COVER_WORDS.expired, verified: true, asOf: today, evidence: p.evidence, reason: `The verified period ${range} has ended.` };
  }
  return { state: "active", label: COVER_WORDS.active, verified: true, asOf: today, evidence: p.evidence, reason: `On cover ${range}, on the evidence linked.` };
}

export function periodWhen(p: { start: string; end: string }, today: string): "current" | "future" | "past" {
  return p.start > today ? "future" : p.end < today ? "past" : "current";
}

/** Which periods overlap which. Any overlap is a conflict a person must settle. */
export function overlaps(periods: { id: string; start: string; end: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>(periods.map((p) => [p.id, []]));
  for (const a of periods) {
    for (const b of periods) {
      if (a.id !== b.id && a.start <= b.end && b.start <= a.end) out.get(a.id)!.push(b.id);
    }
  }
  return out;
}

export type PolicyReading = {
  cover: PolicyCover;
  selectedPeriodId: string | null;
  selection: "requested" | "current" | "upcoming" | "latest" | "none";
  conflicts: { kind: "overlapping_periods"; periodIds: string[]; message: string }[];
};

export function policyCover(periods: PeriodEvidence[], today: string, requested: string | null): PolicyReading {
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const over = overlaps(sorted);
  const conflicts: PolicyReading["conflicts"] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    const others = over.get(p.id)!;
    if (others.length === 0 || seen.has(p.id)) continue;
    const group = [p.id, ...others].filter((id, i, a) => a.indexOf(id) === i).sort();
    group.forEach((id) => seen.add(id));
    const named = group.map((id) => sorted.find((x) => x.id === id)!).map((x) => `${pretty(x.start)} to ${pretty(x.end)}`);
    conflicts.push({ kind: "overlapping_periods", periodIds: group, message: `These periods overlap: ${named.join("; ")}. Only one period can be on cover for any day. Neither is chosen until a person settles which is right.` });
  }

  const current = sorted.filter((p) => periodWhen(p, today) === "current");
  const pick = (id: string | null, selection: PolicyReading["selection"]) => ({ selectedPeriodId: id, selection });
  const requestedOk = requested !== null && sorted.some((p) => p.id === requested) ? requested : null;

  if (sorted.length === 0) {
    return { cover: { state: null, label: "No period on file", verified: false, asOf: today, evidence: [], reason: "This policy has no period recorded, so there is nothing to be on cover." }, conflicts, ...pick(null, "none") };
  }
  if (current.length > 1) {
    return {
      cover: {
        state: null, label: "Two periods both cover today", verified: false, asOf: today, evidence: [],
        reason: `${current.length} periods on this policy each cover ${pretty(today)}. Cover is not stated until a person settles which period is right.`,
      },
      conflicts,
      ...(requestedOk ? pick(requestedOk, "requested") : pick(null, "none")),
    };
  }
  let whole: PolicyCover;
  let chosen: string;
  let why: PolicyReading["selection"];
  if (current.length === 1) {
    whole = periodCover(current[0]!, today);
    chosen = current[0]!.id;
    why = "current";
  } else {
    const upcoming = sorted.filter((p) => p.start > today && p.verified && p.cancellation === null);
    if (upcoming.length > 0) {
      const next = upcoming[0]!;
      whole = periodCover(next, today);
      chosen = next.id;
      why = "upcoming";
    } else {
      const latest = sorted[sorted.length - 1]!;
      whole = periodCover(latest, today);
      chosen = latest.id;
      why = "latest";
    }
  }
  return { cover: whole, conflicts, ...(requestedOk ? pick(requestedOk, "requested") : pick(chosen, why)) };
}
