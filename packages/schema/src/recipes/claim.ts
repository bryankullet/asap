import type { Action } from "../actions.js";
import type { Step } from "../work.js";

/** Claims — UI Build Spec v1 Part 6.6, ten steps. Steps 8, 9 and 10 are three rows and three facts. */
export const CLAIM_RUN_TITLES = {
  capture: "Incident captured",
  cover_check: "Cover on the incident date reviewed",
  clock: "Notification clock checked",
} as const;

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

export function claimSteps(input: { clientName: string; insurerName: string | null }): Step[] {
  const insurer = input.insurerName;
  return [
    step({ id: "capture", label: "Incident captured", actor: "asap", state: "now", actions: [a("prepare", "Capture the incident")] }),
    step({
      id: "match",
      label: "Matched to a policy period",
      actor: "you",
      evidence: [{ kind: "confirmation", label: "The schedule, and which policy period this falls in" }],
      actions: [a("record_evidence", "Choose the policy period", ["evidence_present"])],
    }),
    step({ id: "cover_check", label: "Cover on the incident date reviewed", actor: "asap", actions: [a("prepare", "Review cover on the incident date")] }),
    step({
      id: "clock",
      label: "Notification clock",
      actor: "asap",
      // Spec: "wording clause extracted". Modelled as two named evidence requirements (D-051).
      evidence: [
        { kind: "document", label: "The wording clause and its page" },
        { kind: "confirmation", label: "A verified start event with its date" },
      ],
      actions: [a("prepare", "Check the notification clock")],
    }),
    step({
      id: "documents",
      label: "Documents collected",
      actor: "you",
      evidence: [{ kind: "document", label: "Each document, with who holds any outstanding one" }],
      actions: [a("record_evidence", "All documents received", ["evidence_present"])],
    }),
    step({
      id: "submit",
      label: "Submitted to the insurer",
      actor: "you",
      evidence: [{ kind: "record_send", label: "The submission as sent" }],
      actions: [a("draft", "Draft the submission"), a("record_send", "I sent this", ["evidence_present"])],
    }),
    step({
      id: "response",
      label: "Insurer responded",
      actor: "insurer",
      party: insurer,
      evidence: [{ kind: "document", label: "Their email or letter — not a call note" }],
      actions: [a("record_evidence", "Record their written response", ["evidence_present"])],
    }),
    step({
      id: "offer",
      label: "Settlement offered",
      actor: "insurer",
      party: insurer,
      evidence: [{ kind: "document", label: "The discharge voucher" }],
      actions: [a("record_evidence", "Record the offer", ["evidence_present"])],
    }),
    step({
      id: "acceptance",
      label: "Client accepted",
      actor: "client",
      party: input.clientName,
      evidence: [{ kind: "instruction", label: "The signed acceptance" }],
      actions: [a("record_evidence", "Record the client's acceptance", ["evidence_present"])],
    }),
    step({
      id: "payment",
      label: "Payment received",
      actor: "bank",
      party: "the bank",
      evidence: [{ kind: "confirmation", label: "The receipt" }],
      actions: [a("record_evidence", "Record the receipt", ["evidence_present"]), a("exception", "Record an exception")],
    }),
  ];
}
