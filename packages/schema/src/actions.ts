import { z } from "zod";

/**
 * The work item engine's click contract — UI Build Spec v1, Part 5.2 and 5.3.
 *
 * Nothing outside `ActionVerb` may appear as a button. Guards are named, server-evaluated and
 * re-evaluated at execution time; a stale approval is one whose underlying version moved between
 * render and execute. This file is where both lists are enforced: a button or a guard that is
 * not in these enums does not parse, so it cannot be persisted, rendered or executed.
 */

export const ActionVerb = z.enum([
  "prepare", //          starts a run: reads, extracts, compares, drafts.   never sends anything
  "open", //             navigates to a record or panel.                    never changes state
  "draft", //            opens a draft for the person to copy.              never creates a sent event
  "record_send", //      records that the person actually sent it, with evidence. never sends
  "approve", //          permits one specific action once.                  never performs the business outcome
  "record_evidence", //  records what an outside party did, with the document. never infers it
  "resolve", //          settles a conflict between two sources.            never picks the newer one automatically
  "assign", //           changes owner.                                      never grants data access
  "complete", //         closes the item after its exit checks.             never overrides a failing check
  "exception", //        records lapse, loss, cancellation, complaint, no-bid. never deletes anything
]);
export type ActionVerb = z.infer<typeof ActionVerb>;

export const GuardId = z.enum([
  "client_file_cleared", //   blocks placement approval
  "authority_sufficient", //  blocks placement, refund, settlement; names the limit and who can
  "version_current", //       blocks any approval; names what superseded it and when
  "component_declared", //    blocks any money comparison, settlement line: "This figure does not say what it is."
  "agreed_rate_exists", //    blocks commission expectation: "No agreed rate on file for this class."
  "evidence_present", //      blocks record_send, record_evidence, complete; names the missing evidence
  "no_duplicate_open", //     blocks automation create; names the existing item
  "certificate_unissued", //  blocks certificate issue; prevents a second issue on one number
]);
export type GuardId = z.infer<typeof GuardId>;

/** An action as it may appear on a step or a card. Anything else is not a button. */
export const Action = z.strictObject({
  verb: ActionVerb,
  label: z.string().min(1),
  /** Guards that must all pass at execution time (not only at render). */
  guards: z.array(GuardId).default([]),
  /** Part 4.2 step 7: an action the caller lacks authority for renders disabled with the reason, never hidden. */
  disabledReason: z.string().nullable().default(null),
});
export type Action = z.infer<typeof Action>;

/** Verbs Ask may propose. It opens and prepares things; it cannot send, approve, bind, pay, clear, issue or void (Part 4.3). */
export const ASK_ALLOWED_VERBS: readonly ActionVerb[] = ["prepare", "open", "draft"];

export function isAskAllowed(verb: ActionVerb): boolean {
  return ASK_ALLOWED_VERBS.includes(verb);
}
