/**
 * The one operational reading of a renewal run (D-131). Chat, the Renewal Space, Work and Today all
 * show this — computed here, on the server, from the run's persisted steps — so they can never
 * disagree, and a refresh or another session shows the same truth.
 *
 * It answers seven questions in plain brokerage language: what ASAP is doing now, what it has
 * completed, what is blocking it, what it needs from a person, who it is waiting for, when it will
 * follow up, and what happens after the person acts. It derives; it never authors a business value.
 */

const DAY = 86_400_000;

export type ViewStep = { key: string; state: string; output: Record<string, unknown>; finishedAt: string | null };
export type ViewInput = {
  now: Date;
  /** What the person looking may do — an intervention they cannot use says why. */
  can?: { act: boolean; approve: boolean };
  run: { state: string; currentStep: string | null; exception: { code: string; message: string; needs: string } | null; facts: Record<string, unknown>; startedAt: string };
  steps: ViewStep[];
  approval: { state: string; decidedByName: string | null } | null;
  communications: { audience: string; state: string; partyName: string }[];
  window: { followUpDays: number; escalateDaysBeforeExpiry: number; leadDays: number };
  owner: { id: string; name: string } | null;
  startedByName: string | null;
  periodEnd: string | null;
  insurerName: string | null;
  clientName: string | null;
  delivery: { deliveredAt: string; method: string } | null;
};

export type Blocker = { label: string; blocking: boolean; fix: string | null };
export type PrimaryAction =
  | { kind: "approve"; label: string }
  | { kind: "record_delivery"; label: string }
  | { kind: "resume"; label: string }
  | { kind: "present"; label: string }
  | { kind: "none"; label: string };

export type Upcoming = { kind: "follow_up" | "escalate" | "recheck_delivery" | "recheck_approval"; at: string; label: string };
export type Intervention = { key: string; label: string; available: boolean; why: string | null };

export type RenewalOperational = {
  origin: "window" | "manual";
  originLabel: string;
  status: string;
  tone: "working" | "waiting" | "attention" | "done";
  currentWork: { title: string; detail: string };
  completed: string;
  blockers: Blocker[];
  moreBlockers: number;
  needsFromYou: string | null;
  waitingFor: { party: string; since: string | null } | null;
  nextFollowUpAt: string | null;
  escalatesAt: string | null;
  escalatesTo: string | null;
  chasing: "not_started" | "active" | "stopped";
  afterYouAct: string | null;
  attention: boolean;
  attentionReason: string | null;
  primaryAction: PrimaryAction;
  outputs: { label: string; state: string }[];
  paused: { byName: string | null; at: string | null } | null;
  escalated: boolean;
  upcoming: Upcoming[];
  interventions: Intervention[];
};

/** What a step is doing, in the words a person reads while it runs. */
export const WORKING_ON: Record<string, string> = {
  detect: "Checking the renewal date…",
  completeness: "Checking the client and policy…",
  read_schedule: "Reviewing the schedule…",
  assign_work: "Assigning the work…",
  pack: "Preparing the renewal pack…",
  communications: "Drafting two messages…",
  approval: "Ready for approval",
  open_terms: "Recording the approved insurer request…",
  await_terms: "Waiting for terms…",
  compare: "Comparing the terms with the expiring premium…",
  hand_over: "Handing over to present to the client…",
};

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Nairobi" }) : null;

export function renewalOperational(v: ViewInput): RenewalOperational {
  const done = (k: string) => v.steps.find((s) => s.key === k && (s.state === "done" || s.state === "skipped"));
  const step = (k: string) => v.steps.find((s) => s.key === k);
  const insurer = v.insurerName ?? "the insurer";
  const client = v.clientName ?? "the client";
  const ownerName = v.owner?.name ?? null;
  const origin = v.run.facts["origin"] === "manual" ? "manual" : "window";
  const originLabel =
    origin === "manual"
      ? `Started by ${v.startedByName ?? "a person"} on ${day(v.run.startedAt)}`
      : `Found by ASAP — inside the ${v.window.leadDays}-day renewal window`;

  // ------------------------------------------------------------------ completed, in one sentence
  const parts: string[] = [];
  if (done("completeness")) parts.push("checked the policy");
  if (done("read_schedule")) parts.push((done("read_schedule")!.output["read"] ? "reviewed the schedule" : "looked for the schedule"));
  if (done("pack")) parts.push("prepared the renewal pack");
  if (done("communications")) parts.push("drafted two messages");
  if (done("open_terms")) parts.push("recorded the approved insurer request");
  if (done("compare")) parts.push("compared the terms");
  const completed = parts.length ? "ASAP " + parts.slice(0, -1).join(", ") + (parts.length > 1 ? " and " : "") + parts[parts.length - 1] + "." : "ASAP has just started.";

  // -------------------------------------------------------------------------------- blockers
  const comp = step("completeness")?.output ?? {};
  const blocking = ((comp["blocking"] as { label: string; fix: string }[] | undefined) ?? []).map((b) => ({ label: b.label, blocking: true, fix: b.fix }));
  const nonBlocking = ((comp["nonBlocking"] as string[] | undefined) ?? []).map((l) => ({ label: l, blocking: false, fix: null }));
  const all: Blocker[] = v.run.state === "exception" && v.run.exception?.code !== "missing_information"
    ? [{ label: v.run.exception!.message, blocking: true, fix: v.run.exception!.needs }, ...nonBlocking]
    : [...blocking, ...nonBlocking];
  const blockers = all.slice(0, 3);

  // -------------------------------------------------------------------- follow-up and escalation
  const escalatesAt = v.periodEnd ? new Date(new Date(v.periodEnd + "T06:00:00Z").getTime() - v.window.escalateDaysBeforeExpiry * DAY).toISOString() : null;
  const chasingFacts = v.run.facts["chasing"] as { stopped?: boolean } | undefined;
  const awaitStep = step("await_terms");
  const followUps = Number(awaitStep?.output["followUps"] ?? 0);
  const override = typeof v.run.facts["followUpOn"] === "string" ? String(v.run.facts["followUpOn"]) + "T06:00:00.000Z" : null;
  let nextFollowUpAt: string | null = null;
  let chasing: RenewalOperational["chasing"] = "not_started";
  if (v.delivery && !done("await_terms")) {
    chasing = chasingFacts?.stopped ? "stopped" : "active";
    if (chasing === "active")
      nextFollowUpAt = override ?? new Date(new Date(v.delivery.deliveredAt).getTime() + (followUps + 1) * v.window.followUpDays * DAY).toISOString();
  }

  // ------------------------------------------------------------------------- status and action
  let status = "ASAP is working on it";
  let tone: RenewalOperational["tone"] = "working";
  let currentWork = { title: WORKING_ON[v.run.currentStep ?? ""] ?? "Working…", detail: completed };
  let needsFromYou: string | null = null;
  let waitingFor: RenewalOperational["waitingFor"] = null;
  let afterYouAct: string | null = null;
  let primaryAction: PrimaryAction = { kind: "none", label: "Nothing needed from you now" };
  let attentionReason: string | null = null;

  // Nothing begun yet: queued, not working (D-137). Saying "Checking the renewal date…" while no
  // step has started is how a run waiting for the next pass read as stalled work.
  const begun = v.steps.some((st) => st.state !== "pending");
  if (v.run.state === "running" && !begun) {
    status = "Queued — ASAP starts on its next pass";
    currentWork = { title: "Queued", detail: "ASAP found this renewal and starts on it within a few minutes. Nothing has been done yet." };
  }
  if (v.run.state === "exception") {
    tone = "attention";
    const info = v.run.exception?.code === "missing_information";
    status = info ? `Waiting for information: ${blocking.map((b) => b.label.toLowerCase()).join(" and ")}` : `Stopped — ${v.run.exception?.message ?? "needs a person"}`;
    currentWork = { title: info ? "Stopped safely — information is missing" : "Stopped — needs a person", detail: v.run.exception?.message ?? "" };
    needsFromYou = v.run.exception?.needs ?? null;
    afterYouAct = "ASAP resumes this same renewal from the step that stopped — nothing already done is done again.";
    primaryAction = { kind: "resume", label: "I've fixed it — resume" };
    attentionReason = info ? "Information is missing" : "The renewal stopped";
  } else if (v.run.state === "waiting_approval") {
    tone = "attention";
    status = `Waiting for approval from ${ownerName ?? "an approver"}`;
    currentWork = { title: "Renewal pack ready", detail: `ASAP prepared the renewal pack, the client letter and the terms request to ${insurer}.` };
    needsFromYou = "Review the pack and both messages, then approve the bundle or say what is wrong.";
    afterYouAct = "Approval lets ASAP continue to delivery preparation. Nothing is sent automatically.";
    primaryAction = { kind: "approve", label: "Approve bundle" };
    attentionReason = "Waiting for your approval";
  } else if (v.run.state === "waiting_party" && v.run.currentStep === "await_terms") {
    if (!v.delivery) {
      tone = "attention";
      status = "Approved — not delivered";
      currentWork = { title: `Deliver the terms request to ${insurer}`, detail: "The request is approved but has not been sent — ASAP has no mailbox connected." };
      needsFromYou = `Send the approved request to ${insurer} yourself, then record how it was delivered.`;
      afterYouAct = `ASAP waits for ${insurer}'s terms and follows up ${v.window.followUpDays} days after delivery.`;
      primaryAction = { kind: "record_delivery", label: "Record delivery" };
      attentionReason = "The approved request is not delivered";
    } else {
      waitingFor = { party: insurer, since: v.delivery.deliveredAt };
      const due = nextFollowUpAt ? new Date(nextFollowUpAt) <= v.now : false;
      const chased = followUps > 0;
      tone = chased || due ? "attention" : "waiting";
      status = chasing === "stopped" ? `Waiting for terms from ${insurer} — chasing stopped` : chased ? `Follow-up due: chase ${insurer} for terms` : `Waiting for terms from ${insurer}`;
      currentWork = {
        title: chased ? `Chase ${insurer} (follow-up ${followUps})` : `Waiting for terms from ${insurer}`,
        detail: `Request delivered ${day(v.delivery.deliveredAt)} by ${v.delivery.method.replaceAll("_", " ")}.`,
      };
      if (chased) {
        needsFromYou = `Chase ${insurer} for ${client}'s renewal terms, or record their response when it arrives.`;
        attentionReason = "A follow-up is due";
      }
      afterYouAct = "When terms are recorded, ASAP compares them with the expiring premium and hands the renewal to a person to present.";
    }
  } else if (v.run.state === "done") {
    tone = "done";
    status = "Ready to present to the client";
    currentWork = { title: `Present the terms to ${client}`, detail: "Terms are in and compared with the expiring premium. A client instruction is the client's to give." };
    needsFromYou = `Present the renewal terms to ${client} and record their instruction.`;
    primaryAction = { kind: "present", label: "Open the comparison" };
    attentionReason = "Ready to present";
  } else if (v.run.state === "cancelled") {
    tone = "done";
    status = "Cancelled";
  }

  // ---------------------------------------------------------------- paused, escalated, upcoming
  const pausedFacts = v.run.facts["paused"] as { byName?: string; at?: string } | undefined;
  const paused = pausedFacts ? { byName: pausedFacts.byName ?? null, at: pausedFacts.at ?? null } : null;
  const escalatedFacts = v.run.facts["escalated"] as { byName?: string; at?: string } | undefined;
  const escalated = Boolean(escalatedFacts) || v.run.exception?.code === "no_terms_near_expiry";
  const live = v.run.state !== "done" && v.run.state !== "cancelled";
  if (escalated && live) {
    tone = "attention";
    status = `Escalated to ${ownerName ?? "the work owner"}${v.run.exception?.code === "no_terms_near_expiry" ? ` — no terms from ${insurer} near expiry` : escalatedFacts?.byName ? ` by ${escalatedFacts.byName}` : ""}`;
    attentionReason = "Escalated";
  }
  if (paused && live) {
    status = `Paused by ${paused.byName ?? "a person"} — ASAP will not act until it is resumed`;
    tone = "attention";
    currentWork = { title: "Paused", detail: `${completed} Nothing further happens until a person resumes it.` };
    primaryAction = { kind: "resume", label: "Resume" };
    attentionReason = "Paused";
  }
  const upcoming: Upcoming[] = [];
  if (live && !paused && v.run.state !== "exception") {
    if (nextFollowUpAt) upcoming.push({ kind: "follow_up", at: nextFollowUpAt, label: `Follow up with ${insurer}` });
    if (v.run.state === "waiting_party" && v.run.currentStep === "await_terms" && !v.delivery)
      upcoming.push({ kind: "recheck_delivery", at: new Date(v.now.getTime() + DAY).toISOString(), label: `Check again whether the request to ${insurer} was delivered` });
    if (v.run.state === "waiting_approval") upcoming.push({ kind: "recheck_approval", at: new Date(v.now.getTime() + DAY).toISOString(), label: "Look again for the bundle approval" });
    if (escalatesAt && !escalated && !done("await_terms")) upcoming.push({ kind: "escalate", at: escalatesAt, label: `Escalate to ${ownerName ?? "the work owner"} if there are no terms from ${insurer}` });
  }
  upcoming.sort((a, b) => a.at.localeCompare(b.at));

  // ---------------------------------------------------------------------------- interventions
  const can = v.can ?? { act: true, approve: true };
  const noRole = "Your role cannot change renewal work.";
  const iv = (key: string, label: string, ok: boolean, why: string): Intervention => ({ key, label, available: ok, why: ok ? null : why });
  const finished = !live ? "The renewal is finished." : null;
  const waitingApproval = v.run.state === "waiting_approval";
  const interventions: Intervention[] = [
    iv("approve", "Approve", waitingApproval && can.approve, finished ?? (!can.approve ? "Your role cannot approve what leaves the brokerage." : "There is no bundle waiting for approval.")),
    iv("reject", "Reject", waitingApproval && can.approve, finished ?? (!can.approve ? "Your role cannot approve or reject bundles." : "There is no bundle waiting for approval.")),
    iv("edit", "Edit before approval", false, waitingApproval ? "Edit the records the bundle is built from (policy, contact, premium), then reject this bundle — ASAP rebuilds it from the corrected records." : "There is no bundle waiting for approval."),
    iv("provide_info", "Provide missing information", v.run.state === "exception" && can.act, finished ?? (v.run.state !== "exception" ? "Nothing is missing that stops the renewal." : noRole)),
    iv("assign", "Assign", live && can.act, finished ?? noRole),
    iv("due_date", "Change due date", live && can.act, finished ?? noRole),
    iv("follow_up_date", "Change follow-up date", live && can.act && v.run.state !== "exception", finished ?? (!can.act ? noRole : "The renewal is stopped — resume it first.")),
    iv("follow_up_now", "Follow up now", live && can.act && Boolean(v.delivery) && !done("await_terms"), finished ?? (!can.act ? noRole : !v.delivery ? "There is nothing to follow up yet — the insurer request has not been delivered." : "Terms are already in.")),
    iv("pause", "Pause", live && can.act && !paused, finished ?? (!can.act ? noRole : "It is already paused.")),
    iv("resume", "Resume", live && can.act && (Boolean(paused) || v.run.state === "exception"), finished ?? (!can.act ? noRole : "It is not paused or stopped.")),
    iv("stop", "Stop automation", live && can.act, finished ?? noRole),
    iv("escalate", "Escalate", live && can.act && !escalated, finished ?? (!can.act ? noRole : "It is already escalated.")),
    iv("why", "Ask why", true, ""),
    iv("evidence", "Show evidence", true, ""),
    iv("open", "Open Space", true, ""),
  ];

  const outputs = [
    ...(done("pack") ? [{ label: "Renewal pack", state: v.approval?.state === "approved" ? "Approved" : "Prepared" }] : []),
    ...v.communications.map((c) => ({
      label: c.audience === "client" ? `Letter to ${c.partyName}` : `Terms request to ${c.partyName}`,
      state: c.state === "delivered" ? "Delivered" : c.state === "approved" ? "Approved — not sent" : c.state === "sent" ? "Sent" : "Prepared — not sent",
    })),
  ];

  return {
    origin,
    originLabel,
    status,
    tone,
    currentWork,
    completed,
    blockers,
    moreBlockers: Math.max(all.length - blockers.length, 0),
    needsFromYou,
    waitingFor,
    nextFollowUpAt,
    escalatesAt: v.run.state === "done" || v.run.state === "cancelled" ? null : escalatesAt,
    escalatesTo: ownerName,
    chasing,
    afterYouAct,
    attention: (tone === "attention" || v.run.state === "done") && !(paused && live && v.run.state !== "exception"),
    attentionReason,
    primaryAction,
    outputs,
    paused: live ? paused : null,
    escalated: live && escalated,
    upcoming,
    interventions,
  };
}
