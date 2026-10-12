import type { LivingAction, LivingCommand, LivingCommandInput } from "@asap/schema";
import type { RenewalLivingFacts } from "./facts.js";

/**
 * Governed commands for the Living renewal surface (D-157). Each is offered only where the owning
 * record already says it is available to this viewer — the run's own intervention list, the
 * approval's state, the placement's and the issuance's permissions — and each runs through the
 * endpoint that owns it, which checks everything again. Nothing here decides an outcome.
 */

type Command = Extract<LivingAction, { kind: "command" }>;
const cmd = (command: LivingCommand, label: string, target: string, extra: Partial<Omit<Command, "kind" | "command" | "label" | "target">> = {}): Command => ({
  kind: "command", label, command, target, payload: extra.payload ?? {}, inputs: extra.inputs ?? [], confirm: extra.confirm ?? null, tone: extra.tone ?? "default",
});
const input = (name: string, label: string, kind: LivingCommandInput["kind"], required: boolean, extra: Partial<LivingCommandInput> = {}): LivingCommandInput => ({
  name, label, kind, required, options: extra.options ?? [], hint: extra.hint ?? null,
});
const SUBMISSION_METHODS = [
  { value: "recorded_manual_email", label: "Sent by email from our own mailbox" },
  { value: "recorded_portal", label: "Submitted on the insurer's portal" },
  { value: "recorded_post", label: "Sent by post or courier" },
  { value: "recorded_in_person", label: "Handed over in person" },
];
const submissionInputs = (who: string) => [
  input("method", "How it was sent", "select", true, { options: SUBMISSION_METHODS }),
  input("recipient", `Who at ${who} received it`, "text", true, { hint: "An address, portal reference or name — what proves where it went." }),
  input("sentAt", "When it was sent", "datetime", true),
  input("evidenceNote", "Note (optional)", "textarea", false),
];

/** The run's controls, from the run's own list of what is available now (renewal-view.ts). */
export function runCommands(f: RenewalLivingFacts): Command[] {
  const run = f.run;
  if (!run || !f.viewer.canControlRun) return [];
  const ok = new Set(run.operational.interventions.filter((i) => i.available).map((i) => i.key));
  const out: Command[] = [];
  if (ok.has("resume")) out.push(cmd("run.resume", run.operational.paused ? "Resume ASAP" : "Resume the renewal", run.id, { tone: "primary" }));
  if (ok.has("follow_up_now")) out.push(cmd("run.follow_up_now", "Follow up now", run.id, { confirm: { title: "Follow up now?", body: "ASAP raises the follow-up to the insurer today, as the approved request allows." } }));
  if (ok.has("follow_up_date")) out.push(cmd("run.move_follow_up", "Move the next follow-up", run.id, { inputs: [input("on", "Next follow-up on", "date", true)] }));
  if (ok.has("escalate")) out.push(cmd("run.escalate", "Escalate", run.id, { inputs: [input("reason", "Why it is escalated", "textarea", true)] }));
  if (ok.has("pause")) out.push(cmd("run.pause", "Pause ASAP", run.id, { inputs: [input("reason", "Why (optional)", "textarea", false)] }));
  return out;
}

export type PendingApproval = {
  key: string;
  title: string;
  why: string;
  items: { heading: string; to: string | null; subject: string; body: string }[];
  approverNote: string | null;
  commands: Command[];
};

/** Everything waiting for a person to approve, with exactly what it will send. */
export function pendingApprovals(f: RenewalLivingFacts): PendingApproval[] {
  const out: PendingApproval[] = [];
  const run = f.run;
  if (run && run.state === "waiting_approval" && run.approval && run.approval.state === "pending") {
    const items = run.communications
      .filter((c) => c.state === "prepared")
      .map((c) => ({ heading: c.audience === "client" ? `Letter to ${c.partyName}` : `Terms request to ${c.partyName}`, to: c.toAddress, subject: c.subject.slice(0, 300), body: c.bodyText.slice(0, 20000) }));
    if (items.length) {
      const can = run.permissions.canApprove;
      out.push({
        key: "run",
        title: run.approval.title.slice(0, 200),
        why: "Nothing leaves the brokerage until a person approves this exact content. Approving sends it; returning sends nothing.",
        items,
        approverNote: can ? null : "Your role cannot approve what leaves the brokerage. A principal officer or administrator can.",
        commands: can
          ? [
              cmd("workflow_approval.decide", "Approve and send", run.approval.id, { tone: "primary", payload: { decision: "approve", bundleSha256: run.approval.bundleSha256 }, confirm: { title: "Approve and send?", body: `${items.length} message${items.length === 1 ? "" : "s"} will leave the brokerage exactly as shown.` } }),
              cmd("workflow_approval.decide", "Return with a reason", run.approval.id, { payload: { decision: "reject", bundleSha256: run.approval.bundleSha256 }, inputs: [input("note", "What needs to change", "textarea", true)] }),
            ]
          : [],
      });
    }
  }
  const p = f.placement;
  if (p?.request && !p.request.approval) {
    const can = p.permissions.canApprove;
    out.push({
      key: "placement",
      title: `Placement request to ${p.insurer.name}`.slice(0, 200),
      why: "The request to bind cover leaves only once a person approves this exact version.",
      items: [{ heading: `Placement request · version ${p.request.version}`, to: null, subject: p.request.subject.slice(0, 300), body: p.request.body.slice(0, 20000) }],
      approverNote: can ? null : `Your role cannot approve a placement request.${p.permissions.approverRoles.length ? ` ${p.permissions.approverRoles.join(", ")} can.` : ""}`.slice(0, 300),
      commands: can ? [cmd("placement.approve_request", "Approve the request", p.placement.id, { tone: "primary", payload: { action: "approve_request", placementRequestId: p.request.id }, confirm: { title: "Approve the placement request?", body: `This version may then be sent to ${p.insurer.name}. Approving does not send it and does not create cover.` } })] : [],
    });
  }
  const iss = f.issuance;
  if (p && iss?.request && !iss.request.approval) {
    const can = iss.permissions.canApprove;
    out.push({
      key: "issuance",
      title: `Policy document request to ${p.insurer.name}`.slice(0, 200),
      why: "The request for the policy document leaves only once a person approves this exact version.",
      items: [{ heading: `Issuance request · version ${iss.request.version}`, to: null, subject: iss.request.payload.subject.slice(0, 300), body: iss.request.payload.body.slice(0, 20000) }],
      approverNote: can ? null : "Your role cannot approve an issuance request.",
      commands: can ? [cmd("issuance.approve_request", "Approve the request", p.placement.id, { tone: "primary", payload: { action: "approve_issuance_request", issuanceRequestId: iss.request.id }, confirm: { title: "Approve the policy document request?", body: "It may then be sent to the insurer. Approving does not send it." } })] : [],
    });
  }
  return out;
}

const DELIVERY_METHODS = [
  { value: "own_email", label: "Sent from our own email" },
  { value: "portal", label: "Submitted on the insurer's portal" },
  { value: "printed", label: "Printed and sent" },
  { value: "hand_delivered", label: "Hand delivered" },
  { value: "phone", label: "Read out by phone" },
  { value: "other", label: "Another way" },
];

/**
 * The quotation's own steps, per insurer: record how an approved request was delivered, and record
 * the insurer's answer. Offered only where the quotation says the request is at that point and the
 * viewer may edit it; the quotation endpoint applies its own rules (D-119, 0060).
 */
export function quotationCommands(f: RenewalLivingFacts): Command[] {
  const o = f.opportunity;
  if (!o || o.opportunity.closedAt) return [];
  const out: Command[] = [];
  for (const i of o.insurers) {
    if (i.removedAt || !i.request) continue;
    const delivered = Boolean(i.request.sentAt || i.request.delivery);
    if (i.request.approvedAt && !delivered && o.permissions.canEdit)
      out.push(cmd("quotation.record_delivery", `Record delivery to ${i.insurerName}`.slice(0, 200), o.opportunity.id, {
        payload: { action: "record_delivery", quoteRequestId: i.request.id },
        inputs: [input("method", "How it was delivered", "select", true, { options: DELIVERY_METHODS }), input("reference", "What proves it", "text", true, { hint: "The email subject and time, a portal reference, or who received it." })],
      }));
    if (delivered && !i.response && o.permissions.canRecordResponse)
      out.push(cmd("quotation.record_response", `Record ${i.insurerName}'s answer`.slice(0, 200), o.opportunity.id, {
        tone: "primary",
        payload: { action: "record_response", opportunityInsurerId: i.id },
        inputs: [
          input("outcome", "Their answer", "select", true, { options: [{ value: "quoted", label: "Quoted" }, { value: "declined", label: "Declined" }, { value: "no_response", label: "Will not respond" }] }),
          input("premiumAmount", "Premium (if quoted)", "text", false, { hint: "As written by the insurer, e.g. 2510000.00" }),
          input("premiumCurrency", "Currency", "select", false, { options: [{ value: "KES", label: "KES" }, { value: "USD", label: "USD" }] }),
          input("validUntil", "Valid until", "date", false),
          input("sourceNote", "Where the answer came from", "text", true, { hint: "e.g. Jubilee's email of 12 Oct from underwriting." }),
        ],
      }));
  }
  return out;
}

/** Recording that an approved request left the brokerage — a fact a person attests, with evidence. */
export function submissionCommands(f: RenewalLivingFacts): Command[] {
  const p = f.placement;
  const out: Command[] = [];
  if (p?.request?.approval && !p.request.submission && p.permissions.canRecordSubmission)
    out.push(cmd("placement.record_submission", "Record how the request was sent", p.placement.id, { tone: "primary", payload: { action: "record_submission", placementRequestId: p.request.id }, inputs: submissionInputs(p.insurer.name) }));
  const iss = f.issuance;
  if (p && iss?.request?.approval && !iss.request.submission && iss.permissions.canSubmit)
    out.push(cmd("issuance.record_submission", "Record how the document request was sent", p.placement.id, { tone: "primary", payload: { action: "record_issuance_submission", issuanceRequestId: iss.request.id }, inputs: submissionInputs(p.insurer.name) }));
  return out;
}
