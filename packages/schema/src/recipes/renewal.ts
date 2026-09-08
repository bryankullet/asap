import type { Action } from "../actions.js";
import type { Step } from "../work.js";

/**
 * Renewal — UI Build Spec v1 Part 6.7: nine steps as in the prototype plus step 0, which checks
 * the client file early and warns rather than blocking. The lapse path is loud: if the period end
 * passes with no instruction, cover goes to Expired and the item can only be resolved by placing
 * cover or by an `exception` of kind `lapse` with a typed reason and proof the client was told.
 *
 * Titles name records and outputs, never a recipe. Run titles name what ASAP produced.
 */
export const RENEWAL_RUN_TITLES = {
  file_check: "Client file checked",
  review: "Renewal pack prepared",
  compare: "Term comparison prepared",
} as const;

/** Phrases a run title may never contain: business outcomes (Part 8). */
export const BANNED_RUN_TITLE_PHRASES = [
  /\brenewed\b/i,
  /\bplaced\b/i,
  /\bbound\b/i,
  /\bpaid\b/i,
  /\bapproved\b/i,
  /\bissued\b/i,
  /\bsent\b/i,
];

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

export function renewalSteps(input: { clientName: string; insurers: string[] }): Step[] {
  const insurers = input.insurers.length > 0 ? input.insurers.join(", ") : null;
  return [
    step({
      id: "file_check",
      label: "Client file checked",
      actor: "asap",
      state: "now",
      // client_file_cleared warns only at this step (Part 6.7); it blocks at placement approval.
      actions: [a("prepare", "Check the client file")],
    }),
    step({
      id: "review",
      label: "Expiring policy reviewed",
      actor: "asap",
      actions: [a("prepare", "Prepare the renewal pack")],
    }),
    step({
      id: "exposure",
      label: "Renewed exposure confirmed",
      actor: "you",
      evidence: [
        {
          kind: "confirmation",
          label: `${input.clientName}'s confirmation of what is being renewed`,
        },
      ],
      actions: [a("record_evidence", "Record the client's confirmation", ["evidence_present"])],
    }),
    step({
      id: "request_terms",
      label: "Terms requested",
      actor: "you",
      evidence: [{ kind: "record_send", label: "The request as sent, per insurer" }],
      actions: [
        a("draft", "Draft the request"),
        a("record_send", "I sent this", ["evidence_present"]),
      ],
    }),
    step({
      id: "terms_return",
      label: "Terms received",
      actor: "insurer",
      party: insurers,
      evidence: [{ kind: "document", label: "The insurer's terms or a written decline" }],
      actions: [a("record_evidence", "Record terms received", ["evidence_present"])],
    }),
    step({
      id: "compare",
      label: "Terms compared",
      actor: "asap",
      guards: ["component_declared"],
      actions: [a("prepare", "Compare the terms")],
    }),
    step({
      id: "present",
      label: "Options presented",
      actor: "you",
      evidence: [{ kind: "record_send", label: "What was actually sent to the client" }],
      actions: [
        a("draft", "Draft the recommendation"),
        a("record_send", "I sent this", ["evidence_present"]),
      ],
    }),
    step({
      id: "instruction",
      label: "Client's instruction received",
      actor: "client",
      party: input.clientName,
      evidence: [{ kind: "instruction", label: `${input.clientName}'s instruction, dated` }],
      actions: [a("record_evidence", "Record the client's instruction", ["evidence_present"])],
    }),
    step({
      id: "new_cover",
      label: "New period's cover confirmed",
      actor: "insurer",
      party: insurers,
      evidence: [
        { kind: "confirmation", label: "Cover note or written confirmation for the new period" },
      ],
      actions: [a("record_evidence", "Record the confirmation", ["evidence_present"])],
    }),
    step({
      id: "complete",
      label: "Renewal completed",
      actor: "you",
      actions: [
        a("complete", "Complete", ["evidence_present", "version_current"]),
        a("exception", "Record a lapse or loss"),
      ],
    }),
  ];
}
