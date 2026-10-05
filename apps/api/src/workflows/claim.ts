import { claimDocumentChaseRuleSchema, claimNotificationRuleSchema, clockState, coverReviewSentence, deriveTask, type Step } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditAutomation, sha256, startRun, type StepContext, type StepResult, type WorkflowDefinition } from "./engine.js";
import { autonomyRule, automatic } from "./renewal.js";
import { liveRunsOn, type EventHandler } from "./registry.js";
import { nextFollowUpAt, ruleOr } from "./rules.js";
import { filedEmails, recordFiledWork } from "./inbound.js";

/**
 * The claim workflow (D-143): from a reported claim to the insurer's registration, with every
 * listed document in.
 *
 * ASAP watches the notification clock — the policy wording's clause where a person recorded it on
 * the claim, otherwise the brokerage's `claim.notification_days` rule, said as such — escalates
 * before it runs out, waits for a person to match the claim to a policy period and to notify the
 * insurer, chases the insurer for its claim reference and whoever holds an outstanding document, and
 * finishes with a receipt once the insurer has registered the claim and the documents are in.
 *
 * It never decides or suggests a coverage or claims decision, and it never says whether a late
 * notice matters: that is the insurer's decision. The notice itself is a person's (D-123) until a
 * verified insurer address and a connected mailbox exist.
 */

const DAY = 86_400_000;
export const CLAIM_NOTIFICATION_DEFAULT = { days: 7, escalateDaysBefore: 2 };
export const CLAIM_NOTIFICATION_BASIS =
  "ASAP's working deadline — 7 days after the incident, escalated 2 days before — because neither the policy wording's notification clause nor a brokerage rule is recorded. Record the clause on the claim and its own days apply.";
export const CLAIM_DOCUMENT_CHASE_DEFAULT = { days: 5 };
export const CLAIM_DOCUMENT_CHASE_BASIS = "ASAP's default — chase every 5 days — because this brokerage has not set a claim document chase rule.";

const human = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "not recorded";
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

type Claim = {
  id: string; organization_id: string; work_item_id: string; client_id: string; policy_id: string | null; policy_period_id: string | null; status: string;
  incident_on: string; incident_summary: string; insurer_reference: string | null; registered_at: string | null; created_at: string;
  clock_clause_reference: string | null; clock_clause_page: number | null; clock_clause_days: number | null; clock_start_event: "incident" | "client_aware" | "notified_to_us" | null; clock_start_on: string | null; clock_start_evidence: string | null;
};
type Facts = { claim: Claim; clientName: string; insurerName: string | null; steps: Step[]; documents: { id: string; label: string; holder: string; requested_at: string | null; created_at: string }[] };

async function facts(ctx: StepContext): Promise<Facts> {
  const c = await ctx.db.from("claims").select("*").eq("id", ctx.run.subject_id).maybeSingle();
  const claim = c.data as Claim | null;
  if (!claim) throw new Error("The claim this run is about can no longer be read.");
  const [cl, pol, wi, docs] = await Promise.all([
    ctx.db.from("clients").select("name").eq("id", claim.client_id).maybeSingle(),
    claim.policy_id ? ctx.db.from("policies").select("insurers(name)").eq("id", claim.policy_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.db.from("work_items").select("steps").eq("id", claim.work_item_id).maybeSingle(),
    ctx.db.from("claim_documents").select("id, label, holder, requested_at, created_at").eq("claim_id", claim.id).is("received_at", null).order("created_at"),
  ]);
  return {
    claim,
    clientName: (cl.data as { name: string } | null)?.name ?? "the client",
    insurerName: (pol.data as unknown as { insurers: { name: string } | null } | null)?.insurers?.name ?? null,
    steps: ((wi.data as { steps: Step[] } | null)?.steps ?? []) as Step[],
    documents: (docs.data ?? []) as Facts["documents"],
  };
}

async function setWork(ctx: StepContext, patch: Record<string, unknown>) {
  if (!ctx.run.work_item_id) return;
  const w = await ctx.db.from("work_items").select("version").eq("id", ctx.run.work_item_id).maybeSingle();
  await ctx.db.from("work_items").update({ ...patch, version: ((w.data as { version: number } | null)?.version ?? 1) + 1, updated_at: new Date().toISOString() }).eq("id", ctx.run.work_item_id);
}

/** The notification deadline: the wording's clause where recorded on the claim, else the brokerage's rule. */
async function deadline(ctx: StepContext, claim: Claim): Promise<{ at: Date; escalateAt: Date; basis: string }> {
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "claim.notification_days", claimNotificationRuleSchema, CLAIM_NOTIFICATION_DEFAULT, CLAIM_NOTIFICATION_BASIS);
  const clock = clockState(claim, ctx.now.toISOString().slice(0, 10));
  if (clock.started) {
    const at = new Date(new Date(`${claim.clock_start_on}T00:00:00Z`).getTime() + claim.clock_clause_days! * DAY);
    return { at, escalateAt: new Date(at.getTime() - rule.escalateDaysBefore * DAY), basis: `The policy wording, ${claim.clock_clause_reference} (page ${claim.clock_clause_page}): ${claim.clock_clause_days} days from ${claim.clock_start_event}.` };
  }
  const at = new Date(new Date(`${claim.incident_on}T00:00:00Z`).getTime() + rule.days * DAY);
  return { at, escalateAt: new Date(at.getTime() - rule.escalateDaysBefore * DAY), basis: rule.basis };
}

const stepDone = (steps: Step[], id: string) => steps.find((s) => s.id === id)?.state === "done";
const recordedAt = (steps: Step[], id: string) => steps.find((s) => s.id === id)?.recorded.at(-1)?.recordedAt ?? null;

/** A step that is ASAP's own on the Work item, completed by the run through the one guarded path. */
async function completeStep(ctx: StepContext, stepId: string, note: string): Promise<void> {
  const r = await ctx.db.rpc("work_item_step_by_run", { p_run_id: ctx.run.id, p_step_id: stepId, p_note: note });
  if (r.error) throw new Error(`step ${stepId}: ${r.error.message}`);
}

/**
 * The notification deadline, watched on every step before the insurer is told: an exception once
 * it has passed, an escalation to a person before it does. Null when nothing needs saying.
 */
async function watchDeadline(ctx: StepContext, f: Facts): Promise<StepResult | { escalated: boolean; at: Date; basis: string; escalateAt: Date }> {
  const insurer = f.insurerName ?? "the insurer";
  const d = await deadline(ctx, f.claim);
  if (ctx.now >= d.at)
    return { kind: "exception", code: "notification_deadline_passed", message: `${insurer} has not been told of the claim, and the deadline of ${human(d.at)} has passed. ${d.basis}`, needs: `Notify ${insurer} now and record why it is late. Whether a late notice affects the claim is the insurer's decision — ASAP makes none.` };
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const escalated = ctx.now >= d.escalateAt && automatic(autonomy.actions.escalate);
  if (escalated && !ctx.run.facts["deadlineEscalated"]) {
    await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, deadlineEscalated: true } }).eq("id", ctx.run.id);
    await auditAutomation(ctx.db, ctx.run, "workflow.claim.escalated", { deadline: d.at.toISOString() });
  }
  return { escalated, ...d };
}
const isResult = (x: unknown): x is StepResult => typeof x === "object" && x !== null && "kind" in x;

async function intake(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (!stepDone(f.steps, "capture"))
    await completeStep(ctx, "capture", f.claim.status === "draft" ? "Draft claim. Not registered until a person matches it to a policy period." : "Claim captured.");
  return { kind: "done", output: {}, evidence: [{ kind: "record", label: `Incident of ${human(f.claim.incident_on)} captured: ${f.claim.incident_summary}`, ref: `claim:${f.claim.id}` }] };
}

async function match(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (stepDone(f.steps, "match") && f.claim.policy_period_id) return { kind: "done", output: { policyPeriodId: f.claim.policy_period_id }, evidence: [{ kind: "record", label: "Matched to a policy period by a person", ref: `claim:${f.claim.id}` }] };
  const w = await watchDeadline(ctx, f);
  if (isResult(w)) return w;
  await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Match ${f.clientName}'s claim to a policy period`, reason: `${f.insurerName ?? "The insurer"} should hear of it by ${human(w.at)}. ${w.basis}`, task_next_check: (w.escalated ? w.at : w.escalateAt).toISOString() });
  return { kind: "wait", on: "party", until: w.escalated ? w.at : w.escalateAt };
}

/** Cover on the incident date and the clock: ASAP's own steps, written as the person's cover check writes them. */
async function review(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const evidence: { kind: "record"; label: string; ref: string }[] = [];
  if (!stepDone(f.steps, "cover_check")) {
    const v = f.claim.policy_id ? await ctx.db.rpc("policy_version_on", { p_policy_id: f.claim.policy_id, p_on: f.claim.incident_on }) : { data: [], error: null };
    if (v.error) return { kind: "retry", error: v.error.message };
    const row = ((v.data ?? []) as { id: string; version: number }[])[0];
    const pol = f.claim.policy_id ? await ctx.db.from("policies").select("class_of_business").eq("id", f.claim.policy_id).maybeSingle() : { data: null };
    const className = (pol.data as { class_of_business: string } | null)?.class_of_business;
    const sentence = coverReviewSentence(row && className && f.insurerName ? { found: true, className, insurerName: f.insurerName, version: row.version, on: f.claim.incident_on } : { found: false, on: f.claim.incident_on });
    const w = await ctx.db.rpc("claim_set_cover_review_by_run", { p_run_id: ctx.run.id, p_review: sentence, p_version_id: row?.id ?? null });
    if (w.error) return { kind: "retry", error: w.error.message };
    await completeStep(ctx, "cover_check", sentence);
    evidence.push({ kind: "record", label: sentence, ref: `claim:${f.claim.id}` });
  }
  const again = await facts(ctx);
  if (!stepDone(again.steps, "clock")) {
    const c = clockState(again.claim, ctx.now.toISOString().slice(0, 10));
    const d = await deadline(ctx, again.claim);
    const line = c.started
      ? `Clock running: ${c.days} days from ${c.startEvent.replaceAll("_", " ")} on ${c.startOn} (${c.clause}, page ${c.page}); due ${c.dueOn}.`
      : `${c.reason} Working deadline ${human(d.at)}: ${d.basis}`;
    await completeStep(ctx, "clock", line);
    evidence.push({ kind: "record", label: line, ref: `claim:${f.claim.id}` });
  }
  return { kind: "done", output: {}, evidence };
}

async function documents(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (stepDone(f.steps, "documents")) return { kind: "done", output: { outstanding: f.documents.length }, evidence: [{ kind: "record", label: "Claim documents confirmed complete by a person", ref: `claim:${f.claim.id}` }] };
  const w = await watchDeadline(ctx, f);
  if (isResult(w)) return w;
  const insurer = f.insurerName ?? "the insurer";
  if (w.escalated) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Notify ${insurer} of ${f.clientName}'s claim — due ${human(w.at)}`, reason: `${f.documents.length ? `${f.documents.length} document${f.documents.length === 1 ? " is" : "s are"} still outstanding; the notice should not wait for them. ` : ""}${w.basis}`, task_next_check: w.at.toISOString() });
    return { kind: "wait", on: "party", until: w.at };
  }
  const ours = f.documents.filter((d) => d.holder === "us");
  if (!f.documents.length || ours.length) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: ours.length ? `Prepare ${list(ours.map((d) => d.label))} for the claim` : `Confirm the claim documents are complete, then notify ${insurer}`, reason: `${insurer} should hear of it by ${human(w.at)}. ${w.basis}`, task_next_check: w.escalateAt.toISOString() });
    return { kind: "wait", on: "party", until: w.escalateAt };
  }
  // Chase the party whose document has waited longest; the others follow once it is in.
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "claim.document_chase_days", claimDocumentChaseRuleSchema, CLAIM_DOCUMENT_CHASE_DEFAULT, CLAIM_DOCUMENT_CHASE_BASIS);
  const oldest = [...f.documents].sort((a, b) => (a.requested_at ?? a.created_at).localeCompare(b.requested_at ?? b.created_at))[0]!;
  const held = f.documents.filter((d) => d.holder === oldest.holder);
  const r = await followUp(ctx, { party: holderName(oldest.holder, f), since: oldest.requested_at ?? oldest.created_at, key: oldest.holder, what: list(held.map((d) => d.label)), every: rule.days, basis: rule.basis });
  return r.kind === "wait" && r.until > w.escalateAt ? { ...r, until: w.escalateAt } : r;
}

/** The claim notice, in plain facts: who, which policy, what happened and when. Never a view on cover. */
function noticeText(f: Facts, policyNumber: string | null) {
  const insurer = f.insurerName ?? "the insurer";
  const subject = `Claim notification — ${f.clientName}${policyNumber ? `, policy ${policyNumber}` : ""}, incident of ${human(f.claim.incident_on)}`;
  const body = [
    `Dear ${insurer} claims,`,
    "",
    `We notify you, on behalf of our client ${f.clientName}, of an incident on ${human(f.claim.incident_on)}${policyNumber ? ` under policy ${policyNumber}` : ""}:`,
    "",
    f.claim.incident_summary,
    "",
    "Please register the claim and send us your claim reference and the documents you will need. We will forward what the client provides.",
    "",
    "Kind regards",
  ].join("\n");
  return { subject, body };
}

async function notify(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const insurer = f.insurerName ?? "the insurer";
  if (stepDone(f.steps, "submit") || f.claim.insurer_reference) {
    const at = recordedAt(f.steps, "submit") ?? ctx.now.toISOString();
    return { kind: "done", output: { notifiedAt: at }, evidence: [{ kind: "communication", label: `${insurer} notified ${human(at)}`, ref: `claim:${f.claim.id}` }] };
  }
  const w = await watchDeadline(ctx, f);
  if (isResult(w)) return w;
  const until = w.escalated ? w.at : w.escalateAt;

  // The notice ASAP prepared, if it did: approved and delivered, it completes the "submitted" step (D-150).
  const ap = await ctx.db.from("workflow_approvals").select("id, state, note").eq("run_id", ctx.run.id).eq("step_key", "notify").order("created_at", { ascending: false }).limit(1);
  const approval = ((ap.data ?? []) as { id: string; state: string; note: string | null }[])[0];
  if (approval?.state === "approved") {
    const m = await ctx.db.from("prepared_communications").select("id, state, delivered_at, updated_at").eq("approval_id", approval.id).maybeSingle();
    const msg = m.data as { id: string; state: string; delivered_at: string | null; updated_at: string } | null;
    if (msg && (msg.state === "delivered" || msg.state === "sent")) {
      const at = msg.delivered_at ?? msg.updated_at;
      const r = await ctx.db.rpc("work_item_step_by_run", { p_run_id: ctx.run.id, p_step_id: "submit", p_note: `Claim notice ${msg.state === "sent" ? "sent through the connected mailbox" : "delivered"} ${human(at)}.`, p_communication_id: msg.id });
      if (r.error) return { kind: "retry", error: r.error.message };
      return { kind: "done", output: { notifiedAt: at, communicationId: msg.id }, evidence: [{ kind: "communication", label: `${insurer} notified ${human(at)} with the approved notice`, ref: `prepared_communication:${msg.id}` }] };
    }
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Deliver the approved claim notice to ${insurer} and record how — due ${human(w.at)}`, reason: `The notice is approved but not yet delivered. ${w.basis}`, task_next_check: until.toISOString() });
    return { kind: "wait", on: "party", until };
  }
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const address = await verifiedInsurerAddress(ctx, f);
  if (!approval && address && automatic(autonomy.actions.prepare_claim)) {
    const pol = f.claim.policy_id ? await ctx.db.from("policies").select("policy_number").eq("id", f.claim.policy_id).maybeSingle() : { data: null };
    const t = noticeText(f, (pol.data as { policy_number: string | null } | null)?.policy_number ?? null);
    const bodySha = sha256(`${t.subject}\n\n${t.body}`);
    const bundle = [{ kind: "communication", audience: "insurer", label: `Claim notice to ${insurer}`, to: address, deliveredBy: "The connected mailbox, after your approval — or you, if none is connected", subject: t.subject, body: t.body, sha256: bodySha }];
    const ins = await ctx.db.from("workflow_approvals").insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, step_key: "notify", title: `Approve the claim notice for ${f.clientName}`, bundle, bundle_sha256: sha256(JSON.stringify(bundle)) }).select("id").maybeSingle();
    if (ins.error || !ins.data) return { kind: "retry", error: ins.error?.message ?? "approval not written" };
    const c = await ctx.db.from("prepared_communications").insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, approval_id: (ins.data as { id: string }).id, audience: "insurer", party_name: insurer, to_address: address, subject: t.subject, body_text: t.body, body_sha256: bodySha });
    if (c.error) return { kind: "retry", error: c.error.message };
    await auditAutomation(ctx.db, ctx.run, "workflow.claim.notice_prepared", { approvalId: (ins.data as { id: string }).id });
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Review and approve the claim notice to ${insurer} — due ${human(w.at)}`, reason: `Nothing leaves the brokerage until a person approves its exact content. ${w.basis}`, task_next_check: until.toISOString() });
    return { kind: "wait", on: "approval", until };
  }
  if (approval?.state === "pending") return { kind: "wait", on: "approval", until };
  await setWork(ctx, {
    task_status: "needs_you", task_party: null, task_since: null,
    required_action: w.escalated ? `Notify ${insurer} of ${f.clientName}'s claim — due ${human(w.at)}` : `Notify ${insurer} of the claim by ${human(w.at)}`,
    reason: approval?.state === "rejected"
      ? `The prepared notice was not approved${approval.note ? `: ${approval.note}` : ""}. Notify ${insurer} yourself. ${w.basis}`
      : `${w.basis} ASAP prepares the notice for approval once ${insurer} has a verified address on file.`,
    task_next_check: until.toISOString(),
  });
  return { kind: "wait", on: "party", until, output: { deadline: w.at.toISOString() } };
}

async function verifiedInsurerAddress(ctx: StepContext, f: Facts): Promise<string | null> {
  if (!f.insurerName) return null;
  const r = await ctx.db.from("insurer_contacts").select("email, insurers!inner(name)").eq("organization_id", ctx.run.organization_id).eq("insurers.name", f.insurerName).is("retired_at", null).order("verified_at").limit(1);
  return ((r.data ?? []) as { email: string }[])[0]?.email ?? null;
}

/** One outside party, followed up on the brokerage's cadence; the Work names them and since when. */
async function followUp(ctx: StepContext, o: { party: string; since: string; key: string; what: string; every: number; basis: string }): Promise<StepResult> {
  const filed = filedEmails(ctx);
  if (filed.length) {
    await setWork(ctx, recordFiledWork(filed[0]!, "what arrived"));
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY) };
  }
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const done = Number((ctx.step.output["followUps"] as Record<string, number> | undefined)?.[o.key] ?? 0);
  const nextAt = nextFollowUpAt(o.since, done, o.every);
  await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, withParty: o.party, withPartySince: o.since } }).eq("id", ctx.run.id);
  const followUps = { ...((ctx.step.output["followUps"] as Record<string, number> | undefined) ?? {}) };
  if (ctx.now >= nextAt && automatic(autonomy.actions.follow_up)) {
    const n = done + 1;
    followUps[o.key] = n;
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Chase ${o.party} for ${o.what} (follow-up ${n})`, reason: `Asked ${human(o.since)}; nothing back after ${n * o.every} days. ${o.basis}`, task_next_check: new Date(ctx.now.getTime() + o.every * DAY).toISOString() });
    await auditAutomation(ctx.db, ctx.run, "workflow.claim.follow_up", { party: o.party, what: o.what, followUp: n });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + o.every * DAY), output: { followUps } };
  }
  if (done === 0) await setWork(ctx, { task_status: "with_party", task_party: o.party, task_since: o.since, required_action: `${o.party[0]!.toUpperCase()}${o.party.slice(1)} to send ${o.what}`, task_next_check: nextAt.toISOString() });
  return { kind: "wait", on: "party", until: nextAt, output: { followUps } };
}

async function registration(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const insurer = f.insurerName ?? "the insurer";
  if (f.claim.insurer_reference) return { kind: "done", output: { reference: f.claim.insurer_reference }, evidence: [{ kind: "response", label: `${insurer} registered the claim: ${f.claim.insurer_reference}`, ref: `claim:${f.claim.id}` }] };
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "claim.document_chase_days", claimDocumentChaseRuleSchema, CLAIM_DOCUMENT_CHASE_DEFAULT, CLAIM_DOCUMENT_CHASE_BASIS);
  const since = recordedAt(f.steps, "submit") ?? ((ctx.step.output["since"] as string | undefined) ?? ctx.now.toISOString());
  const r = await followUp(ctx, { party: insurer, since, key: "insurer", what: "its claim reference", every: rule.days, basis: rule.basis });
  return r.kind === "wait" ? { ...r, output: { ...r.output, since } } : r;
}

const holderName = (holder: string, f: Facts) =>
  holder === "client" ? f.clientName : holder === "insurer" ? (f.insurerName ?? "the insurer") : holder === "us" ? "us" : `the ${holder}`;

async function finish(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const insurer = f.insurerName ?? "the insurer";
  const outcome = `Claim registered by ${insurer} (${f.claim.insurer_reference}) — every listed document received`;
  await ctx.db.from("workflow_receipts").upsert({
    organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "claim", client_id: f.claim.client_id, work_item_id: ctx.run.work_item_id,
    title: `Claim — ${f.clientName}, incident of ${human(f.claim.incident_on)}`, outcome,
    receipt: { intendedOutcome: `${insurer} registers the claim with what it needs to assess it`, achievedOutcome: outcome, decision: `${insurer} decides the claim. ASAP made no coverage or claims decision.`, nothingSent: "ASAP sent nothing itself: the notice and every document went from people." },
  }, { onConflict: "run_id", ignoreDuplicates: true });
  // The Work item goes back to its own steps: the insurer's response is what is next.
  const t = deriveTask(f.steps);
  await setWork(ctx, { task_status: t.status, task_party: t.party, task_since: t.status === "with_party" ? ctx.now.toISOString() : null, required_action: t.status === "with_party" ? `${insurer} to respond to the claim` : null, reason: null });
  return { kind: "done", output: { outcome }, evidence: [{ kind: "record", label: outcome }] };
}

export const CLAIM: WorkflowDefinition = {
  workflow: "claim",
  steps: [
    { key: "intake", label: "Incident captured", run: intake },
    { key: "match", label: "Matched to a policy period by a person", run: match },
    { key: "review", label: "Cover on the incident date and the notification clock checked", run: review },
    { key: "documents", label: "Outstanding documents chased", maxAttempts: 5, run: documents },
    { key: "notify", label: "Insurer notified by a person, before the deadline", run: notify },
    { key: "registration", label: "Insurer's claim reference awaited and chased", maxAttempts: 5, run: registration },
    { key: "finish", label: "Claim registered; documents in", run: finish },
  ],
};

async function startFor(db: SupabaseClient, organizationId: string, claimId: string): Promise<string | null> {
  const rule = await autonomyRule(db, organizationId);
  if (!automatic(rule.actions.prepare_claim)) return null;
  const c = await db.from("claims").select("id, work_item_id, client_id").eq("organization_id", organizationId).eq("id", claimId).maybeSingle();
  const row = c.data as { id: string; work_item_id: string; client_id: string } | null;
  if (!row) return null;
  return (await startRun(db, CLAIM, { organizationId, subjectType: "claim", subjectId: row.id, workItemId: row.work_item_id, facts: { clientId: row.client_id, origin: "event" }, once: true })).runId;
}

const wake: EventHandler = async (db, _l, ev) => (ev.entity_id ? liveRunsOn(db, ev.organization_id, "claim", ev.entity_id) : []);

export const CLAIM_EVENTS: Partial<Record<string, EventHandler>> = {
  "claim.reported": async (db, _l, ev) => {
    const id = await startFor(db, ev.organization_id, ev.entity_id!);
    return id ? [id] : [];
  },
  "claim.changed": wake,
  "claim.registered": wake,
};
