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
    attention: tone === "attention" || v.run.state === "done",
    attentionReason,
    primaryAction,
    outputs,
  };
}
