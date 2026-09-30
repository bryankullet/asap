import type { NextAction, WorkItemRow } from "@asap/schema";

/**
 * The next action on any work item, derived from the records — the one shape Today, Work, Ask and
 * the record's Space read (D-120).
 *
 *   * Step-driven work (renewal, servicing, endorsement…): the step that is now, who holds it and
 *     the evidence it still lacks.
 *   * Work whose state the server derives from its record (quotation, claim): the fields written
 *     by work_item_set_state (0060), which the record's own derivation keeps current.
 *   * Neither: a kind-specific first move, worded as what is missing — never "decide the first
 *     step", which told a broker nothing.
 */
const OUTSIDE = new Set(["insurer", "client", "assessor", "garage", "third_party"]);

const KIND_FIRST: Partial<Record<WorkItemRow["kind"], { what: string; why: string; missing: string[] }>> = {
  renewal: { what: "Request renewal terms from the insurer", why: "Cover ends on its expiry date; terms take time to arrive and to compare.", missing: ["Renewal terms"] },
  claim: { what: "Collect the claim documents and notify the insurer", why: "An insurer can refuse a late claim; the documents are what they assess.", missing: ["Claim form", "Supporting documents"] },
  new_business: { what: "Record the requirements and choose the insurers to approach", why: "Insurers quote on what the client gives them.", missing: ["Requirements", "Insurers"] },
  endorsement: { what: "Confirm the change with the insurer", why: "A mid-term change is not in force until the insurer confirms it.", missing: ["Insurer confirmation"] },
  tor: { what: "Get the insurer's time-on-risk confirmation", why: "Cover before issue needs the insurer's written confirmation.", missing: ["Insurer confirmation"] },
};

export function workNext(item: WorkItemRow): NextAction {
  const record = { type: "work_item" as const, id: item.id, label: item.title };
  const outside = item.task_status === "with_party";
  const base = {
    party: outside ? item.task_party : null,
    since: outside ? item.task_since : null,
    checkAt: item.task_next_check,
    record,
  };
  if (item.task_status === "done") {
    return { ...base, what: "Nothing more — this work is done", holder: "nobody", missing: [], why: item.reason ?? "It was completed.", action: null, stage: "done" };
  }

  const step = item.steps.find((s) => s.state === "now" || s.state === "blocked") ?? null;
  if (step) {
    const missing = step.evidence.filter((e) => !step.recorded.some((r) => r.kind === e.kind)).map((e) => e.label);
    const external = OUTSIDE.has(step.actor);
    const act = step.actions[0] as { verb?: string; label?: string } | undefined;
    return {
      ...base,
      what: step.state === "blocked" && step.reason ? `${step.label} — blocked: ${step.reason}` : step.label,
      holder: external ? "outside_party" : "brokerage",
      party: external ? (item.task_party ?? step.party) : null,
      since: external ? item.task_since : null,
      missing,
      why: item.reason ?? "This is the step the work is waiting on.",
      action: act?.verb ? { name: act.verb, label: act.label ?? step.label, targetId: item.id } : null,
      stage: `step:${step.id}`,
    };
  }

  if (item.required_action) {
    return {
      ...base,
      what: item.required_action,
      holder: outside ? "outside_party" : "brokerage",
      missing: item.evidence_needed ? item.evidence_needed.split(/;\s*/).filter(Boolean) : [],
      why: item.reason ?? "",
      action: null,
      stage: "derived",
    };
  }

  const first = KIND_FIRST[item.kind];
  if (first) return { ...base, what: first.what, holder: outside ? "outside_party" : "brokerage", missing: first.missing, why: first.why, action: null, stage: "first" };
  return {
    ...base,
    what: `Record what this ${item.kind.replace(/_/g, " ")} work needs next`,
    holder: outside ? "outside_party" : "brokerage",
    missing: ["The next step for this work"],
    why: item.reason ?? "Nothing on file says what happens next.",
    action: null,
    stage: "unknown",
  };
}
