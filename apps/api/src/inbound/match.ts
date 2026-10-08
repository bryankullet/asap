import type { InboundCandidate, InboundKind } from "@asap/schema";

/**
 * Which live workflow runs an inbound email could belong to (D-144) — deterministic, and the only
 * list the model may ever choose from. A pure function over a snapshot of the brokerage's live
 * runs, so the routing evaluation measures exactly what production runs.
 *
 * A run is a candidate only when the email's kind is one that run can be waiting for, and only on
 * evidence: the same thread, a reference the run owns (policy, claim, cover-note or vehicle
 * number), a reply to a subject the run sent, or the sender's address being one the run wrote to.
 * A name alone is never enough.
 */
export type RunSnapshot = {
  runId: string;
  workflow: string;
  step: string | null;
  workItemId: string | null;
  /** Who the run is waiting on, by name. */
  party: string | null;
  /** Addresses the run wrote to, or the party's verified contacts. Lower case. */
  partyAddresses: string[];
  clientName: string | null;
  clientAddresses: string[];
  /** References the run owns: policy numbers, claim and cover-note references, registrations. */
  references: string[];
  /** Subjects of messages the run sent or prepared. */
  subjects: string[];
};
export type InboundEmail = { from: string; subject: string; body: string; threadWorkItemId: string | null };

/** Which runs can be waiting for each kind of email. New work (an enquiry, a new claim) has none. */
export const KIND_WORKFLOWS: Readonly<Record<InboundKind, readonly string[]>> = {
  insurer_quote: ["quotation", "renewal"],
  insurer_decline: ["quotation", "renewal", "placement"],
  insurer_confirmation: ["placement", "endorsement"],
  policy_document: ["issuance"],
  claim_notice: [],
  claim_update: ["claim"],
  endorsement_request: [],
  servicing_request: [],
  new_enquiry: [],
  other: [],
};

/** The score a candidate needs: more than a name, at least one piece of real evidence. */
export const CANDIDATE_MIN_SCORE = 3;
/** How far ahead the best candidate must be to be the one that fits without a tie-break. */
export const DOMINANCE = 4;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stripReply = (s: string) => norm(s).replace(/^((re|fw|fwd|aw)\s*:\s*)+/i, "");
const domainOf = (a: string) => a.split("@")[1] ?? "";
const PUBLIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "ymail.com"]);

export function matchCandidates(email: InboundEmail, kind: InboundKind | null, runs: RunSnapshot[]): InboundCandidate[] {
  const text = norm(`${email.subject}\n${email.body}`);
  const squeezed = compact(text);
  const subject = stripReply(email.subject);
  const from = email.from.toLowerCase();
  const out: InboundCandidate[] = [];
  for (const r of runs) {
    // Without a kind (no model answered), every live run is eligible — but nothing will be routed.
    if (kind && !KIND_WORKFLOWS[kind].includes(r.workflow)) continue;
    let score = 0;
    const why: string[] = [];
    if (email.threadWorkItemId && r.workItemId && email.threadWorkItemId === r.workItemId) {
      score += 5;
      why.push("Same email thread as this work");
    }
    // References compared without spaces or punctuation: "KDX 123A" and "KDX123A" are one vehicle.
    for (const ref of r.references.filter((x) => compact(x).length >= 5)) {
      if (squeezed.includes(compact(ref))) {
        score += 4;
        why.push(`Mentions ${ref}`);
      }
    }
    const replied = r.subjects.find((s) => s.trim().length >= 8 && subject.includes(stripReply(s)));
    if (replied) {
      score += 4;
      why.push(`Replies to “${replied}”`);
    }
    if (r.partyAddresses.includes(from)) {
      score += 3;
      why.push(`Sent from ${from}, an address this work wrote to`);
    } else {
      const d = domainOf(from);
      if (d && !PUBLIC_DOMAINS.has(d) && r.partyAddresses.some((a) => domainOf(a) === d)) {
        score += 2;
        why.push(`Sent from ${d}, ${r.party ?? "the party"}'s domain`);
      }
    }
    if (r.clientAddresses.includes(from)) {
      score += 3;
      why.push(`Sent from ${r.clientName ?? "the client"}'s address`);
    }
    if (r.party && r.party.length >= 3 && text.includes(norm(r.party))) {
      score += 1;
      why.push(`Names ${r.party}`);
    }
    if (r.clientName && r.clientName.length >= 3 && text.includes(norm(r.clientName))) {
      score += 1;
      why.push(`Names ${r.clientName}`);
    }
    if (score >= CANDIDATE_MIN_SCORE) out.push({ runId: r.runId, workflow: r.workflow, party: r.party, score, why });
  }
  // One candidate per run: a run waiting on two insurers is one place to file an email.
  const best = new Map<string, InboundCandidate>();
  for (const c of out) if (!best.has(c.runId) || best.get(c.runId)!.score < c.score) best.set(c.runId, c);
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Whether ASAP may route by itself: a model classification at or above the brokerage's threshold,
 * and exactly one run that fits — either the only candidate, or the one the model chose among the
 * deterministic candidates with the same confidence.
 */
export function decideRoute(input: {
  source: "model" | "none";
  confidence: number | null;
  threshold: number;
  candidates: InboundCandidate[];
  tieBreak: { runId: string; confidence: number } | null;
}): { route: string | null; why: string } {
  if (input.source !== "model" || input.confidence === null) return { route: null, why: "A person decides where it belongs." };
  if (input.confidence < input.threshold) return { route: null, why: `ASAP is ${Math.round(input.confidence * 100)}% sure what this email is — below the ${Math.round(input.threshold * 100)}% this brokerage requires.` };
  if (input.candidates.length === 0) return { route: null, why: "No work in progress is waiting for an email like this." };
  if (input.candidates.length === 1) return { route: input.candidates[0]!.runId, why: input.candidates[0]!.why.join("; ") };
  // One run fits when its evidence outweighs the next by a whole reference or reply: the others
  // match only on who sent it, which every run with that insurer shares.
  const [top, second] = input.candidates as [InboundCandidate, InboundCandidate];
  if (top.score - second.score >= DOMINANCE) return { route: top.runId, why: `${top.why.join("; ")} — the others fit only on the sender` };
  const tb = input.tieBreak;
  const chosen = tb && tb.confidence >= input.threshold ? input.candidates.find((c) => c.runId === tb.runId) : undefined;
  if (chosen) return { route: chosen.runId, why: `${chosen.why.join("; ")} — chosen among ${input.candidates.length} that could fit` };
  return { route: null, why: `${input.candidates.length} pieces of work could be waiting for this email; a person chooses.` };
}
