import { WORKFLOW_NOUN, type WorkflowName } from "@asap/schema";
import type { Intervention, PrimaryAction, RenewalOperational } from "./renewal-view.js";

/**
 * The operational reading of any run that is not a renewal (D-139), in the same shape as the
 * renewal's so Ask, Work and the Space read every workflow the same way. Derived from the run and
 * its steps on the server; it authors no business value. Renewal keeps its own, richer reading.
 */
export type RunViewInput = {
  workflow: string;
  can?: { act: boolean; approve: boolean };
  run: {
    state: string;
    currentStep: string | null;
    exception: { code: string; message: string; needs: string } | null;
    facts: Record<string, unknown>;
  };
  steps: { key: string; label: string; state: string; output: Record<string, unknown> }[];
  approval: { state: string; decidedByName: string | null } | null;
  owner: { id: string; name: string } | null;
  startedByName: string | null;
  waitingFor: { party: string; since: string | null } | null;
};

export function runOperational(v: RunViewInput): RenewalOperational {
  const noun = WORKFLOW_NOUN[v.workflow as WorkflowName] ?? "work";
  const doneSteps = v.steps.filter((s) => s.state === "done" || s.state === "skipped");
  const current =
    v.steps.find((s) => s.key === v.run.currentStep) ??
    v.steps.find((s) => s.state !== "done" && s.state !== "skipped") ??
    null;
  const live = v.run.state !== "done" && v.run.state !== "cancelled";
  const paused = (v.run.facts["paused"] as { byName?: string; at?: string } | undefined) ?? null;
  const completed = doneSteps.length
    ? "ASAP has done: " + doneSteps.map((s) => s.label.toLowerCase()).join("; ") + "."
    : "ASAP has just started.";
  const begun = v.steps.some((s) => s.state !== "pending");

  let status = "ASAP is working on it";
  let tone: RenewalOperational["tone"] = "working";
  let currentWork = { title: current?.label ?? "Working", detail: completed };
  let needsFromYou: string | null = null;
  let afterYouAct: string | null = null;
  let primaryAction: PrimaryAction = { kind: "none", label: "Nothing needed from you now" };
  let attentionReason: string | null = null;
  let waitingFor = v.waitingFor;

  if (v.run.state === "running" && !begun) {
    status = "Queued — ASAP starts on its next pass";
    currentWork = { title: "Queued", detail: "Nothing has been done yet." };
  } else if (v.run.state === "exception") {
    tone = "attention";
    status = `Stopped — ${v.run.exception?.message ?? "needs a person"}`;
    currentWork = { title: "Stopped — needs a person", detail: v.run.exception?.message ?? "" };
    needsFromYou = v.run.exception?.needs ?? null;
    afterYouAct = `ASAP resumes this same ${noun} from the step that stopped — nothing already done is done again.`;
    primaryAction = { kind: "resume", label: "I've fixed it — resume" };
    attentionReason = "Stopped";
  } else if (v.run.state === "waiting_approval") {
    tone = "attention";
    status = `Waiting for approval from ${v.owner?.name ?? "an approver"}`;
    needsFromYou = "Review what ASAP prepared, then approve it or say what is wrong.";
    afterYouAct = "Approval lets ASAP continue. Nothing is sent automatically.";
    primaryAction = { kind: "approve", label: "Approve" };
    attentionReason = "Waiting for your approval";
  } else if (v.run.state === "waiting_party") {
    tone = "waiting";
    status = waitingFor
      ? `With ${waitingFor.party}`
      : `Waiting on ${current?.label.toLowerCase() ?? "the next step"}`;
    if (!waitingFor) waitingFor = null;
  } else if (v.run.state === "done") {
    tone = "done";
    status = "Done";
    currentWork = { title: "Done", detail: completed };
  } else if (v.run.state === "cancelled") {
    tone = "done";
    status = "Stopped by a person";
  }
  if (paused && live) {
    status = `Paused by ${paused.byName ?? "a person"} — ASAP will not act until it is resumed`;
    tone = "attention";
    currentWork = {
      title: "Paused",
      detail: `${completed} Nothing further happens until a person resumes it.`,
    };
    primaryAction = { kind: "resume", label: "Resume" };
    attentionReason = "Paused";
  }

  const can = v.can ?? { act: true, approve: true };
  const noRole = `Your role cannot change ${noun} work.`;
  const finished = !live ? `The ${noun} is finished.` : null;
  const waitingApproval = v.run.state === "waiting_approval";
  const iv = (key: string, label: string, ok: boolean, why: string): Intervention => ({
    key,
    label,
    available: ok,
    why: ok ? null : why,
  });
  const interventions: Intervention[] = [
    iv(
      "approve",
      "Approve",
      waitingApproval && can.approve,
      finished ??
        (!can.approve
          ? "Your role cannot approve what leaves the brokerage."
          : "There is nothing waiting for approval."),
    ),
    iv(
      "reject",
      "Reject",
      waitingApproval && can.approve,
      finished ??
        (!can.approve
          ? "Your role cannot approve or reject."
          : "There is nothing waiting for approval."),
    ),
    iv(
      "provide_info",
      "Provide missing information",
      v.run.state === "exception" && can.act,
      finished ??
        (v.run.state !== "exception" ? `Nothing is missing that stops the ${noun}.` : noRole),
    ),
    iv("assign", "Assign", live && can.act, finished ?? noRole),
    iv("due_date", "Change due date", live && can.act, finished ?? noRole),
    iv(
      "pause",
      "Pause",
      live && can.act && !paused,
      finished ?? (!can.act ? noRole : "It is already paused."),
    ),
    iv(
      "resume",
      "Resume",
      live && can.act && (Boolean(paused) || v.run.state === "exception"),
      finished ?? (!can.act ? noRole : "It is not paused or stopped."),
    ),
    iv("stop", "Stop automation", live && can.act, finished ?? noRole),
    iv("why", "Ask why", true, ""),
    iv("evidence", "Show evidence", true, ""),
    iv("open", "Open Space", true, ""),
  ];

  return {
    origin: v.startedByName ? "manual" : "window",
    originLabel: v.startedByName
      ? `Started by ${v.startedByName}`
      : "Started by ASAP from your records",
    status,
    tone,
    currentWork,
    completed,
    blockers:
      v.run.state === "exception" && v.run.exception
        ? [{ label: v.run.exception.message, blocking: true, fix: v.run.exception.needs }]
        : [],
    moreBlockers: 0,
    needsFromYou,
    waitingFor,
    nextFollowUpAt: null,
    escalatesAt: null,
    escalatesTo: v.owner?.name ?? null,
    chasing: "not_started",
    afterYouAct,
    attention: tone === "attention" && !(paused && live && v.run.state !== "exception"),
    attentionReason,
    primaryAction,
    outputs: [],
    paused: live
      ? paused
        ? { byName: paused.byName ?? null, at: paused.at ?? null }
        : null
      : null,
    escalated: false,
    upcoming: [],
    interventions,
  };
}
