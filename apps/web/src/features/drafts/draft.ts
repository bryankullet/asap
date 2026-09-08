import type { DraftRow } from "@asap/schema";

/**
 * Draft and send, client side (UI Build Spec v1 Part 7). These are the only two transitions a
 * draft has. Copying advances nothing. A send is recorded by a person, with a confirmation and
 * evidence; the API and the database refuse anything else, and so does this function, so the
 * dialog cannot even produce the request.
 */

export function markCopied(draft: DraftRow, now: Date): DraftRow {
  return { ...draft, copied_at: draft.copied_at ?? now.toISOString() };
}

export type SendReview = { confirmed: boolean; evidence: string; outcomeUnknown?: boolean };

export const SEND_REVIEW_ERROR = "Confirm that you sent it and say where the evidence is.";

export type SendDecision =
  { ok: true; evidence: string; outcomeUnknown: boolean } | { ok: false; reason: string };

/** Decides whether a send may be recorded. Never touches sent_at itself: only the API does that. */
export function reviewSend(draft: DraftRow, review: SendReview): SendDecision {
  if (draft.sent_at) return { ok: false, reason: "This was already recorded as sent." };
  const evidence = review.evidence.trim();
  if (!review.confirmed || evidence.length === 0) return { ok: false, reason: SEND_REVIEW_ERROR };
  return { ok: true, evidence, outcomeUnknown: review.outcomeUnknown ?? false };
}

/** Retry is disabled while the outcome of a recorded send is unknown (Part 7, last rule). */
export function canRetry(draft: DraftRow): boolean {
  return draft.sent_at !== null && !draft.outcome_unknown;
}
