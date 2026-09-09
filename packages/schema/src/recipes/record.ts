import type { GuardId } from "../actions.js";
import type { Step, WorkItemKind, WorkItemRow } from "../work.js";

/**
 * How a record page is composed — UI Build Spec v1 Part 14.
 *
 * The page leads with one focus card stating the next decision, and the rest is arranged by the
 * record's kind. Nothing here reads new data or evaluates a guard: it arranges the step and guard
 * state the engine already produced.
 */

/** The sections a record page can carry, in the order they may appear. */
export const RECORD_SECTIONS_ORDER = ["focus", "servicing", "drafts", "steps", "activity"] as const;
export type RecordSection = (typeof RECORD_SECTIONS_ORDER)[number];

/**
 * The panel order per kind, following the prototype's `recipe()`. Part 1: detailed fields appear
 * only for the current task, so a kind lists only the panels its work actually needs — a claim
 * carries its documents and what happened, a reconciliation does not.
 *
 * A section listed here renders only when the record has something to put in it. A kind whose
 * panels arrive with a later phase (money, compliance, import) lists what it has today; the parts
 * still to come are named in Part 14, not stubbed here.
 */
export const RECORD_SECTIONS: Record<WorkItemKind, readonly RecordSection[]> = {
  renewal: ["focus", "drafts", "steps", "activity"],
  new_business: ["focus", "drafts", "steps", "activity"],
  placement: ["focus", "steps", "drafts", "activity"],
  claim: ["focus", "servicing", "drafts", "steps", "activity"],
  endorsement: ["focus", "servicing", "steps", "activity"],
  tor: ["focus", "steps", "drafts", "activity"],
  certificate: ["focus", "steps", "activity"],
  compliance: ["focus", "steps", "activity"],
  money_in: ["focus", "drafts", "steps", "activity"],
  money_out: ["focus", "drafts", "steps", "activity"],
  reconciliation: ["focus", "steps", "activity"],
  wht: ["focus", "steps", "activity"],
  import: ["focus", "steps", "activity"],
  exception: ["focus", "steps", "activity"],
};

/**
 * What a person must do to clear each guard, in business words. The focus card names this when a
 * step is blocked, so its action opens the thing that unblocks it rather than the step itself.
 */
export const GUARD_BLOCKERS: Record<GuardId, string> = {
  client_file_cleared: "the client's file is cleared",
  authority_sufficient: "someone with the authority for this sum insured approves",
  version_current: "this is re-checked against the version that superseded it",
  component_declared: "each figure says what it is",
  agreed_rate_exists: "an agreed rate for this class is on file",
  evidence_present: "the evidence is recorded",
  no_duplicate_open: "the item already open for this is closed",
  certificate_unissued: "an unissued certificate number is used",
  business_rule_exists: "the brokerage's rule for this is recorded",
  stock_available: "certificate stock is available",
  screening_source_configured: "a screening list is connected",
};

/**
 * The next decision in business words, keyed by `kind:stepId`. The step's own label names the step;
 * this names the decision a person is being asked to take. Where a step has no entry the label
 * stands in, which is the honest fallback — inventing a sentence would be worse than a plain one.
 */
const HEADLINES: Record<string, string> = {
  // Placement (Part 6.2)
  "placement:prepare": "Prepare the placement",
  "placement:approve": "Approve this placement",
  "placement:instruct": "Instruct the insurer",
  "placement:requirements": "Answer the underwriting requirements",
  "placement:cover_confirmed": "Confirm cover is on risk",
  "placement:documents": "Check the policy documents",
  "placement:complete": "Close the placement",
  // Renewal (Part 6.7)
  "renewal:file_check": "Check the client's file",
  "renewal:review": "Review the expiring cover",
  "renewal:exposure": "Confirm what is being insured",
  "renewal:request_terms": "Ask the insurers for terms",
  "renewal:terms_return": "Collect the insurers' terms",
  "renewal:compare": "Compare the terms",
  "renewal:present": "Put the options to the client",
  "renewal:instruction": "Record the client's instruction",
  "renewal:new_cover": "Confirm the new cover",
  "renewal:complete": "Close the renewal",
  // Claim (Part 6.6)
  "claim:capture": "Capture the incident",
  "claim:match": "Choose the policy period this falls in",
  "claim:cover_check": "Review cover on the incident date",
  "claim:clock": "Check the notification clock",
  "claim:documents": "Collect the claim documents",
  "claim:submit": "Submit the claim to the insurer",
  "claim:response": "Record the insurer's written response",
  "claim:offer": "Record the settlement offered",
  "claim:acceptance": "Record the client's acceptance",
  "claim:payment": "Record the payment received",
  // Endorsement (Part 6.3)
  "endorsement:classify": "Classify what is being changed",
  "endorsement:requirements": "Check what the change needs",
  "endorsement:request": "Ask the insurer for the change",
  "endorsement:response": "Record the insurer's answer, item by item",
  "endorsement:update_policy": "Apply the confirmed changes",
  "endorsement:premium": "Record the additional premium",
};

export type FocusCard = {
  /** Always "Next step", so a person learns where to look once. */
  eyebrow: string;
  /** The decision, in business words. */
  headline: string;
  /** One sentence saying why this is here. */
  why: string;
  /** Set when the step cannot be taken yet: what has to happen first. */
  blockedBy: string | null;
};

/** The step a person is being asked to take: the one that is now, or blocked and waiting on them. */
export function currentStep(item: Pick<WorkItemRow, "steps">): Step | null {
  return item.steps.find((s) => s.state === "now" || s.state === "blocked") ?? null;
}

/**
 * The focus card for a record. Derived, never authored: the headline comes from the current step,
 * the sentence from the reason the engine already wrote, the blocker from the step's own state.
 */
export function focusCard(
  item: Pick<WorkItemRow, "kind" | "steps" | "reason" | "task_status" | "exception">,
  step: Step | null = currentStep(item),
): FocusCard {
  const eyebrow = "Next step";
  if (!step) {
    if (item.exception) {
      return {
        eyebrow,
        headline: "This was closed without completing",
        why: item.exception.reason,
        blockedBy: null,
      };
    }
    return {
      eyebrow,
      headline:
        item.task_status === "done" ? "Everything here is finished" : "Nothing needs you here",
      why: item.reason ?? "No step is waiting on a person.",
      blockedBy: null,
    };
  }
  const headline = HEADLINES[`${item.kind}:${step.id}`] ?? step.label;
  const blockedBy =
    step.state === "blocked"
      ? (step.reason ?? namedBlocker(step))
      : (step.actions.find((a) => a.disabledReason)?.disabledReason ?? null);
  return {
    eyebrow,
    headline: blockedBy ? `${headline} — not yet` : headline,
    why: item.reason ?? blockedBy ?? `${step.label} is the step waiting on a person.`,
    blockedBy,
  };
}

/** When a blocked step carries no reason, name the first guard it is waiting on. */
function namedBlocker(step: Step): string | null {
  const first = step.guards[0];
  if (!first) return null;
  const id = (typeof first === "string" ? first : first.id) as GuardId;
  const blocker = GUARD_BLOCKERS[id];
  return blocker ? `This waits until ${blocker}.` : null;
}
