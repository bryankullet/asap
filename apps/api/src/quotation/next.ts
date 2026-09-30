import type { NextAction, OpportunityInsurer, OpportunityResponse } from "@asap/schema";

/**
 * Quotation work, read as a sequence (D-119):
 *
 *   need recorded → requirements gathered → insurers selected → request prepared → human review
 *   → approval → delivered by a person (no mailbox) with evidence → with <insurer> → reply
 *   → terms reviewed → comparison.
 *
 * Every function here is pure: the same records always give the same stage and the same next
 * action, so Today, Work, Ask and the Space — which all read this — cannot disagree.
 */

type InsurerIn = Omit<OpportunityInsurer, "stage" | "stageLabel">;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

export function insurerStage(i: InsurerIn): { stage: OpportunityInsurer["stage"]; stageLabel: string } {
  if (i.removedAt) return { stage: "removed", stageLabel: "No longer approached" };
  if (i.response?.outcome === "declined") return { stage: "declined", stageLabel: "Declined" };
  if (i.response) return { stage: "quoted", stageLabel: "Terms received" };
  if (i.request?.delivery) return { stage: "with_insurer", stageLabel: `With ${i.insurerName} since ${day(i.request.delivery.deliveredAt)}` };
  if (i.request?.approvedAt) return { stage: "approved_to_deliver", stageLabel: "Approved — not yet delivered" };
  if (i.request) return { stage: "request_prepared", stageLabel: "Request prepared — awaiting approval" };
  return { stage: "not_asked", stageLabel: "Not asked yet" };
}

const names = (xs: { insurerName: string }[]) =>
  xs.length === 1 ? xs[0]!.insurerName : xs.length === 2 ? `${xs[0]!.insurerName} and ${xs[1]!.insurerName}` : `${xs.length} insurers`;

/** Three working days after the request reached the insurer, the broker should look again. */
function chaseAt(deliveredAt: string): string {
  const d = new Date(deliveredAt);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString();
}

export function quotationNext(o: Omit<OpportunityResponse, "next">): NextAction {
  const record = { type: "opportunity" as const, id: o.opportunity.id, label: `${o.client.name} — ${o.opportunity.title}` };
  const base = { party: null, since: null, missing: [] as string[], checkAt: null, record };

  if (o.opportunity.closedAt) {
    return { ...base, what: "Nothing more — this quotation work is closed", holder: "nobody", why: o.opportunity.closedReason ?? "It was closed.", action: null, stage: "closed" };
  }

  const outstanding = o.requirements.filter((r) => r.required && !r.suppliedAt);
  const live = o.insurers.filter((i) => !i.removedAt);
  const stage = (s: OpportunityInsurer["stage"]) => live.filter((i) => i.stage === s);

  if (outstanding.length > 0) {
    return {
      ...base,
      what: `Collect the outstanding requirement${outstanding.length === 1 ? "" : "s"} from the client`,
      holder: "brokerage",
      missing: outstanding.map((r) => r.label),
      why: "Insurers quote on what the client gives; a request sent without it comes back with questions.",
      action: { name: "supply_requirement", label: "Mark a requirement supplied", targetId: outstanding[0]!.id },
      stage: "requirements",
    };
  }
  if (live.length === 0) {
    return { ...base, what: "Choose the insurers to approach", holder: "brokerage", missing: ["At least one insurer"], why: "No insurer can quote until they are asked.", action: { name: "add_insurer", label: "Add an insurer", targetId: null }, stage: "insurers" };
  }
  const notAsked = stage("not_asked");
  if (notAsked.length > 0) {
    return { ...base, what: `Prepare the request to ${names(notAsked)}`, holder: "brokerage", why: "The request is what the insurer quotes on; it is reviewed and approved before it goes.", action: { name: "prepare_request", label: "Prepare the request", targetId: notAsked[0]!.id }, stage: "prepare" };
  }
  const toApprove = stage("request_prepared");
  if (toApprove.length > 0) {
    return { ...base, what: `Review and approve the request to ${names(toApprove)}`, holder: "brokerage", why: "Nothing leaves the brokerage without a person's approval of the exact text.", action: { name: "approve_request", label: "Approve the request", targetId: toApprove[0]!.request!.id }, stage: "approve" };
  }
  const toDeliver = stage("approved_to_deliver");
  if (toDeliver.length > 0) {
    return {
      ...base,
      what: `Deliver the approved request to ${names(toDeliver)} and record how`,
      holder: "brokerage",
      missing: ["Delivery reference (no mailbox is connected, so ASAP does not send it)"],
      why: "Until it reaches the insurer, nobody is working on a quote.",
      action: { name: "record_delivery", label: "Record delivery", targetId: toDeliver[0]!.request!.id },
      stage: "deliver",
    };
  }
  const waiting = stage("with_insurer");
  if (waiting.length > 0) {
    const first = [...waiting].sort((a, b) => (a.request!.delivery!.deliveredAt < b.request!.delivery!.deliveredAt ? -1 : 1))[0]!;
    const since = first.request!.delivery!.deliveredAt;
    return {
      ...base,
      what: waiting.length === 1 ? `Chase ${first.insurerName} for terms` : `Chase ${names(waiting)} for terms`,
      holder: "outside_party",
      party: waiting.length === 1 ? first.insurerName : names(waiting),
      since,
      checkAt: chaseAt(since),
      why: "The client is waiting on terms; a request nobody chases goes quiet.",
      action: { name: "record_response", label: "Record the reply received", targetId: first.id },
      stage: "with_insurer",
    };
  }
  const quoted = stage("quoted");
  if (quoted.length > 0) {
    return { ...base, what: `Review the terms from ${names(quoted)} and compare them for the client`, holder: "brokerage", why: "The client chooses from a fair comparison, with anything unclear shown as unclear.", action: { name: "generate_comparison", label: "Compare the terms", targetId: null }, stage: "compare" };
  }
  return { ...base, what: "No insurer quoted — approach another insurer or close this work", holder: "brokerage", why: "Every insurer asked has declined.", action: { name: "add_insurer", label: "Add an insurer", targetId: null }, stage: "all_declined" };
}

/** The same next action, as the fields a work item carries (work_item_set_state, 0060). */
export function workStateFrom(next: NextAction) {
  return {
    p_task_status: next.stage === "closed" ? "done" : next.holder === "outside_party" ? "with_party" : "needs_you",
    p_task_party: next.holder === "outside_party" ? next.party : null,
    p_task_since: next.holder === "outside_party" ? next.since : null,
    p_task_next_check: next.checkAt,
    p_reason: next.why,
    p_required_action: next.what,
    p_evidence_needed: next.missing.length ? next.missing.join("; ") : null,
  };
}
