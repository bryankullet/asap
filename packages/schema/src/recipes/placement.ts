import type { Action } from "../actions.js";
import type { Step } from "../work.js";

/**
 * Placement — UI Build Spec v1 Part 6.2. Step 2 is X01: approval is blocked while the client's
 * file is Not started, Incomplete or Blocked (Screen Map v3 Part 4.1). A principal-officer
 * override needs a typed reason, is audited, and lands on the principal's Today.
 * `authority_sufficient` is listed by the spec on this step; it is not evaluable until authority
 * limits exist (D-043), so it is not on the recipe yet and the omission is recorded.
 */
export const PLACEMENT_RUN_TITLES = {
  prepare: "Placement prepared",
  documents: "Policy documents checked",
} as const;

const a = (verb: Action["verb"], label: string, guards: Action["guards"] = []): Action => ({
  verb,
  label,
  guards,
  disabledReason: null,
});
const step = (s: Pick<Step, "id" | "label" | "actor"> & Partial<Step>): Step => ({
  state: "todo",
  guards: [],
  evidence: [],
  actions: [],
  party: null,
  reason: null,
  recorded: [],
  runId: null,
  ...s,
});

export function placementSteps(input: {
  clientName: string;
  insurer: string;
  classOfBusiness: string;
}): Step[] {
  return [
    step({
      id: "prepare",
      label: "Placement prepared",
      actor: "asap",
      state: "now",
      actions: [a("prepare", "Prepare the placement")],
    }),
    step({
      id: "approve",
      label: "Placement approved",
      actor: "you",
      guards: ["client_file_cleared", "version_current"],
      evidence: [{ kind: "approval", label: "Approval record" }],
      actions: [a("approve", "Approve", ["client_file_cleared", "version_current"])],
    }),
    step({
      id: "instruct",
      label: `${input.insurer} instructed`,
      actor: "you",
      evidence: [{ kind: "record_send", label: "The instruction as sent" }],
      actions: [
        a("draft", "Draft the instruction"),
        a("record_send", "I sent this", ["evidence_present"]),
      ],
    }),
    step({
      id: "requirements",
      label: "Underwriting requirements",
      actor: "insurer",
      party: input.insurer,
      evidence: [{ kind: "document", label: "Each requirement and its response" }],
      actions: [a("record_evidence", "Record the requirements", ["evidence_present"])],
    }),
    step({
      id: "cover_confirmed",
      label: "Cover confirmed",
      actor: "insurer",
      party: input.insurer,
      evidence: [{ kind: "confirmation", label: "Cover note or written confirmation" }],
      actions: [a("record_evidence", "Record the confirmation", ["evidence_present"])],
    }),
    step({
      id: "documents",
      label: "Policy documents checked",
      actor: "asap",
      actions: [a("prepare", "Check the documents")],
    }),
    step({
      id: "complete",
      label: `${input.clientName} — ${input.classOfBusiness} placed`,
      actor: "you",
      actions: [
        a("complete", "Complete", ["evidence_present", "version_current"]),
        a("exception", "Record an exception"),
      ],
    }),
  ];
}
