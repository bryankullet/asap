import type { Action } from "../actions.js";
import type { Step } from "../work.js";

/**
 * Endorsement — UI Build Spec v1 Part 6.3, six steps. Step 3 lists `authority_sufficient`; it is
 * not evaluable until authority limits exist and is left off the recipe (D-048, work list).
 */
export const ENDORSEMENT_RUN_TITLES = { classify: "Request classified", requirements: "Requirements checked" } as const;

const a = (verb: Action["verb"], label: string, guards: Action["guards"] = []): Action => ({ verb, label, guards, disabledReason: null });
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

export function endorsementSteps(input: { insurerName: string }): Step[] {
  return [
    step({ id: "classify", label: "Request classified", actor: "asap", state: "now", actions: [a("prepare", "Classify the request")] }),
    step({ id: "requirements", label: "Requirements checked", actor: "asap", actions: [a("prepare", "Check the requirements")] }),
    step({
      id: "request",
      label: `${input.insurerName} asked`,
      actor: "you",
      evidence: [{ kind: "record_send", label: "The request as sent" }],
      actions: [a("draft", "Draft the request"), a("record_send", "I sent this", ["evidence_present"])],
    }),
    step({
      id: "response",
      label: "Insurer responded, item by item",
      actor: "insurer",
      party: input.insurerName,
      evidence: [{ kind: "document", label: "Their written response, with a decision recorded on every item" }],
      actions: [a("record_evidence", "Record their written response", ["evidence_present"])],
    }),
    step({
      id: "update_policy",
      label: "Policy updated",
      actor: "you",
      guards: ["version_current"],
      evidence: [{ kind: "approval", label: "The new policy version" }],
      actions: [a("approve", "Apply the confirmed changes", ["evidence_present", "version_current"])],
    }),
    step({
      id: "premium",
      label: "Additional premium",
      actor: "finance",
      party: "finance",
      guards: ["component_declared"],
      evidence: [{ kind: "document", label: "The invoice" }],
      actions: [a("record_evidence", "Record the invoice", ["evidence_present"]), a("exception", "Record an exception")],
    }),
  ];
}
