import { chaseRuleSchema, deriveTask, ENDORSEMENT_KIND_LABELS, endorsementRequirementsMissing, EndorsementRow, TRANSFER_NEEDS_POLICYHOLDER, type Step } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditAutomation, sha256, startRun, type StepContext, type StepResult, type WorkflowDefinition } from "./engine.js";
import { autonomyRule, automatic } from "./renewal.js";
import { liveRunsOn, type EventHandler } from "./registry.js";
import { nextFollowUpAt, ruleOr } from "./rules.js";
import { filedEmails, recordFiledWork } from "./inbound.js";

/**
 * The endorsement workflow (D-143): from a client's request to the confirmed change on the policy.
 *
 * ASAP completes its own steps on the Work item — the classification made at intake, the
 * requirements check (a transfer of ownership waits for the policyholder's own instruction,
 * TRANSFER_NEEDS_POLICYHOLDER) — prepares the request to the insurer and asks a person to approve
 * its exact text, waits for a person to deliver it, chases the insurer on `endorsement.chase`, and
 * waits for a person to record the insurer's itemised answer and to apply the confirmed change.
 * The premium adjustment — additional or return premium on the insurer's note, or none — is a
 * person's record (D-154); the run waits for it and names it on the receipt. ASAP moves no money.
 */

const DAY = 86_400_000;
export const ENDORSEMENT_CHASE_DEFAULT = { followUpDays: 3, deadlineDays: 10, escalateDaysBefore: 2 };
export const ENDORSEMENT_CHASE_BASIS =
  "ASAP's default — chase the insurer 3 days after the request is delivered, expect its answer within 10 days, escalate 2 days before — because this brokerage has not set an endorsement chase rule.";

const human = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "not recorded";

type Facts = { e: EndorsementRow; clientName: string; clientId: string; insurerName: string; policyNumber: string | null; steps: Step[] };

async function facts(ctx: StepContext): Promise<Facts> {
  const r = await ctx.db.from("endorsements").select("*").eq("id", ctx.run.subject_id).maybeSingle();
  if (!r.data) throw new Error("The endorsement this run is about can no longer be read.");
  const e = EndorsementRow.parse(r.data);
  const [pol, wi] = await Promise.all([
    ctx.db.from("policies").select("policy_number, client_id, clients(name), insurers(name)").eq("id", e.policy_id).maybeSingle(),
    ctx.db.from("work_items").select("steps").eq("id", e.work_item_id).maybeSingle(),
  ]);
  const p = pol.data as unknown as { policy_number: string | null; client_id: string; clients: { name: string } | null; insurers: { name: string } | null } | null;
  return { e, clientName: p?.clients?.name ?? "the client", clientId: p?.client_id ?? "", insurerName: p?.insurers?.name ?? "the insurer", policyNumber: p?.policy_number ?? null, steps: ((wi.data as { steps: Step[] } | null)?.steps ?? []) as Step[] };
}

async function setWork(ctx: StepContext, patch: Record<string, unknown>) {
  if (!ctx.run.work_item_id) return;
  const w = await ctx.db.from("work_items").select("version").eq("id", ctx.run.work_item_id).maybeSingle();
  await ctx.db.from("work_items").update({ ...patch, version: ((w.data as { version: number } | null)?.version ?? 1) + 1, updated_at: new Date().toISOString() }).eq("id", ctx.run.work_item_id);
}

async function completeStep(ctx: StepContext, stepId: string, note: string, communicationId?: string): Promise<void> {
  const r = await ctx.db.rpc("work_item_step_by_run", { p_run_id: ctx.run.id, p_step_id: stepId, p_note: note, ...(communicationId ? { p_communication_id: communicationId } : {}) });
  if (r.error) throw new Error(`step ${stepId}: ${r.error.message}`);
}

const stepDone = (steps: Step[], id: string) => steps.find((s) => s.id === id)?.state === "done";
const DAY_WAIT = (ctx: StepContext) => new Date(ctx.now.getTime() + DAY);

async function classify(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (!f.e.kind) {
    // The keyword reading at intake found more than one kind of change, or none: a person says which.
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: "Say what kind of change this is", reason: `ASAP could not tell from the request: “${f.e.request_text.slice(0, 160)}”.` });
    return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
  }
  const label = ENDORSEMENT_KIND_LABELS[f.e.kind];
  if (!stepDone(f.steps, "classify")) await completeStep(ctx, "classify", `Classified as: ${label.toLowerCase()}.`);
  return { kind: "done", output: { kind: f.e.kind }, evidence: [{ kind: "record", label: `Classified as: ${label.toLowerCase()}`, ref: `endorsement:${f.e.id}` }] };
}

async function requirements(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (f.e.kind === "transfer_ownership" && !(f.e.instruction_from === "policyholder" && f.e.instruction_reference)) {
    const who = f.e.requested_by_name ?? "someone other than the policyholder";
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: "Record the policyholder's own instruction", reason: `${TRANSFER_NEEDS_POLICYHOLDER} This request came from ${who}; it is recorded, not acted on.` });
    return { kind: "wait", on: "party", until: DAY_WAIT(ctx), output: { blockedBy: "policyholder_instruction" } };
  }
  const missing = endorsementRequirementsMissing(f.e);
  if (missing.length) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Add ${missing.join(", ")}`, reason: `The insurer cannot be asked without ${missing.join("; ")}.` });
    return { kind: "wait", on: "party", until: DAY_WAIT(ctx), output: { missing } };
  }
  const line = `Ready: ${f.e.items.length} item${f.e.items.length === 1 ? "" : "s"} effective ${human(f.e.effective_on)}.`;
  if (!stepDone(f.steps, "requirements")) await completeStep(ctx, "requirements", line);
  return { kind: "done", output: {}, evidence: [{ kind: "record", label: line, ref: `endorsement:${f.e.id}` }] };
}

function requestText(f: Facts) {
  const subject = `Endorsement request — ${f.clientName}${f.policyNumber ? `, policy ${f.policyNumber}` : ""}`;
  const lines = f.e.items.map((i) => `- ${i.label}${i.before || i.after ? `: ${i.before ?? "(new)"} → ${i.after ?? "(removed)"}` : ""}`);
  const body = [
    `Dear ${f.insurerName} underwriting,`,
    "",
    `On behalf of ${f.clientName}, please endorse ${f.policyNumber ? `policy ${f.policyNumber}` : "the policy"} with effect from ${human(f.e.effective_on)}:`,
    "",
    ...lines,
    "",
    "Please confirm each item in writing, with any additional or return premium.",
    "",
    "Kind regards",
  ].join("\n");
  return { subject, body };
}

async function approval(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  // Sent by a person from the Work item itself: approval and delivery are already theirs.
  if (stepDone(f.steps, "request")) return { kind: "done", output: { viaWorkItem: true }, evidence: [{ kind: "approval", label: "Request sent by a person from the Work item" }] };
  const existing = await ctx.db.from("workflow_approvals").select("id, state, decided_by, note").eq("run_id", ctx.run.id).eq("step_key", "approval").order("created_at", { ascending: false }).limit(1);
  const a = ((existing.data ?? []) as { id: string; state: string; decided_by: string | null; note: string | null }[])[0];
  if (a?.state === "approved") return { kind: "done", output: { approvalId: a.id, approvedBy: a.decided_by }, evidence: [{ kind: "approval", label: "Endorsement request approved by a person", ref: `workflow_approval:${a.id}` }] };
  if (a?.state === "rejected") return { kind: "exception", code: "bundle_rejected", message: `The endorsement request was not approved${a.note ? `: ${a.note}` : ""}.`, needs: "Change the endorsement's items or date, then resume — ASAP prepares the request again and asks for approval of the new text." };
  if (!a) {
    const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
    if (!automatic(autonomy.actions.prepare_endorsement)) {
      await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Draft the endorsement request to ${f.insurerName}`, reason: "This brokerage has not let ASAP prepare endorsement requests." });
      return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
    }
    const t = requestText(f);
    const bodySha = sha256(t.subject + "\n\n" + t.body);
    const bundle = [{ kind: "communication", audience: "insurer", label: `Endorsement request to ${f.insurerName}`, to: null, deliveredBy: "You — no verified address is on file", subject: t.subject, body: t.body, sha256: bodySha }];
    const ins = await ctx.db.from("workflow_approvals").insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, step_key: "approval", title: `Approve the endorsement request for ${f.clientName}`, bundle, bundle_sha256: sha256(JSON.stringify(bundle)) }).select("id").maybeSingle();
    if (ins.error || !ins.data) return { kind: "retry", error: ins.error?.message ?? "approval not written" };
    const approvalId = (ins.data as { id: string }).id;
    const c = await ctx.db.from("prepared_communications").insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, approval_id: approvalId, audience: "insurer", party_name: f.insurerName, to_address: null, subject: t.subject, body_text: t.body, body_sha256: bodySha });
    if (c.error) return { kind: "retry", error: c.error.message };
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Review and approve the endorsement request to ${f.insurerName}`, reason: "Nothing leaves the brokerage until a person approves its exact content." });
    await auditAutomation(ctx.db, ctx.run, "workflow.endorsement.approval_requested", { approvalId });
  }
  return { kind: "wait", on: "approval", until: DAY_WAIT(ctx) };
}

async function delivery(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const c = await ctx.db.from("prepared_communications").select("id, state, delivered_at, delivery_method, updated_at").eq("run_id", ctx.run.id).neq("state", "superseded").order("created_at", { ascending: false }).limit(1);
  const m = ((c.data ?? []) as { id: string; state: string; delivered_at: string | null; delivery_method: string | null; updated_at: string }[])[0];
  if (!m && stepDone(f.steps, "request")) return { kind: "done", output: { viaWorkItem: true }, evidence: [{ kind: "communication", label: `Request sent to ${f.insurerName} by a person from the Work item` }] };
  if (m && (m.state === "delivered" || m.state === "sent")) {
    const at = m.delivered_at ?? m.updated_at;
    if (!stepDone(f.steps, "request")) await completeStep(ctx, "request", `Delivered to ${f.insurerName} ${human(at)}${m.delivery_method ? ` by ${m.delivery_method.replaceAll("_", " ")}` : ""}.`, m.id);
    return { kind: "done", output: { deliveredAt: at }, evidence: [{ kind: "communication", label: `Request delivered to ${f.insurerName} ${human(at)}`, ref: `prepared_communication:${m.id}` }] };
  }
  await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Deliver the approved endorsement request to ${f.insurerName} and record how`, reason: "The request is approved but not delivered — no mailbox is connected, so a person sends it." });
  return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
}

async function response(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (stepDone(f.steps, "response")) return { kind: "done", output: { reference: f.e.response_reference }, evidence: [{ kind: "response", label: `${f.insurerName} answered item by item${f.e.response_reference ? ` (${f.e.response_reference})` : ""}`, ref: `endorsement:${f.e.id}` }] };
  if (f.e.items.length && f.e.items.every((i) => i.decision !== "pending")) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Record ${f.insurerName}'s written response on the Work item`, reason: "Every item has the insurer's decision; the written response completes the step." });
    return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
  }
  const filed = filedEmails(ctx);
  if (filed.length) {
    await setWork(ctx, recordFiledWork(filed[0]!, "the itemised answer"));
    return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
  }
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "endorsement.chase", chaseRuleSchema, ENDORSEMENT_CHASE_DEFAULT, ENDORSEMENT_CHASE_BASIS);
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const sentAt = (ctx.run.facts["deliveredAt"] as string | undefined) ?? f.steps.find((s) => s.id === "request")?.recorded.at(-1)?.recordedAt ?? ctx.now.toISOString();
  const deadline = new Date(new Date(sentAt).getTime() + rule.deadlineDays * DAY);
  const followUps = Number(ctx.step.output["followUps"] ?? 0);
  const escalated = Boolean(ctx.step.output["escalated"]);
  const nextAt = nextFollowUpAt(sentAt, followUps, rule.followUpDays);
  const escalateAt = new Date(deadline.getTime() - rule.escalateDaysBefore * DAY);
  await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, withParty: f.insurerName, withPartySince: sentAt, deliveredAt: sentAt } }).eq("id", ctx.run.id);
  if (ctx.now >= deadline) return { kind: "exception", code: "no_answer_by_deadline", message: `${f.insurerName} has not answered the endorsement request by ${human(deadline)}.`, needs: `Call ${f.insurerName}, and tell ${f.clientName} where the change stands.` };
  if (!escalated && ctx.now >= escalateAt && automatic(autonomy.actions.escalate)) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `${f.insurerName}'s answer is due ${human(deadline)} — nothing yet`, reason: `Escalated ${rule.escalateDaysBefore} days before it is due. ${rule.basis}` });
    await auditAutomation(ctx.db, ctx.run, "workflow.endorsement.escalated", { deadline: deadline.toISOString() });
    return { kind: "wait", on: "party", until: deadline, output: { followUps, escalated: true } };
  }
  if (ctx.now >= nextAt && automatic(autonomy.actions.follow_up)) {
    const n = followUps + 1;
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Chase ${f.insurerName} for its answer to the endorsement (follow-up ${n})`, reason: `Delivered ${human(sentAt)}; nothing back after ${n * rule.followUpDays} days. ${rule.basis}`, task_next_check: new Date(ctx.now.getTime() + rule.followUpDays * DAY).toISOString() });
    await auditAutomation(ctx.db, ctx.run, "workflow.endorsement.follow_up", { followUp: n });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + rule.followUpDays * DAY), output: { followUps: n, escalated } };
  }
  if (followUps === 0 && !escalated) await setWork(ctx, { task_status: "with_party", task_party: f.insurerName, task_since: sentAt, required_action: `${f.insurerName} to answer the endorsement request`, task_next_check: nextAt.toISOString() });
  return { kind: "wait", on: "party", until: [nextAt, escalateAt].filter((d) => d > ctx.now).sort((a, b) => a.getTime() - b.getTime())[0] ?? DAY_WAIT(ctx), output: { followUps, escalated } };
}

async function apply(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  if (f.e.applied_version_id || stepDone(f.steps, "update_policy")) return { kind: "done", output: { versionId: f.e.applied_version_id }, evidence: [{ kind: "approval", label: "Confirmed changes applied to the policy by a person", ref: `endorsement:${f.e.id}` }] };
  const accepted = f.e.items.filter((i) => i.decision === "accepted").length;
  await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: "Apply the confirmed changes to the policy", reason: `${f.insurerName} accepted ${accepted} of ${f.e.items.length} item${f.e.items.length === 1 ? "" : "s"}. A rejected item stays uncovered and visible on the policy.` });
  return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
}

type Adjustment = { direction: "additional" | "return" | "none"; amount: string | null; currency: string | null; reference: string };
const money = (amount: string, currency: string) => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const adjustmentText = (a: Adjustment) =>
  a.direction === "none" ? `No premium adjustment: ${a.reference}` : `${a.direction === "additional" ? "Additional" : "Return"} premium ${money(a.amount!, a.currency!)} (${a.reference})`;

async function adjustment(ctx: StepContext): Promise<Adjustment | null> {
  const r = await ctx.db.from("endorsement_premium_adjustments").select("direction, amount, currency, reference").eq("endorsement_id", ctx.run.subject_id).maybeSingle();
  return (r.data as Adjustment | null) ?? null;
}

async function premium(ctx: StepContext): Promise<StepResult> {
  const a = await adjustment(ctx);
  if (a) return { kind: "done", output: { direction: a.direction }, evidence: [{ kind: "record", label: adjustmentText(a), ref: `endorsement:${ctx.run.subject_id}` }] };
  const f = await facts(ctx);
  await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Record ${f.insurerName}'s debit or credit note for the change — or that there is none`, reason: "The change is on the policy. The premium adjustment is whatever the insurer's note says; ASAP moves no money." });
  return { kind: "wait", on: "party", until: DAY_WAIT(ctx) };
}

async function finish(ctx: StepContext): Promise<StepResult> {
  const f = await facts(ctx);
  const a = await adjustment(ctx);
  const accepted = f.e.items.filter((i) => i.decision === "accepted").length;
  const outcome = `Endorsement applied — ${accepted} of ${f.e.items.length} item${f.e.items.length === 1 ? "" : "s"} confirmed by ${f.insurerName}`;
  await ctx.db.from("workflow_receipts").upsert({
    organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "endorsement", client_id: f.clientId || null, work_item_id: ctx.run.work_item_id,
    title: `Endorsement — ${f.clientName}${f.policyNumber ? `, ${f.policyNumber}` : ""}`, outcome,
    receipt: { intendedOutcome: `The requested change on ${f.clientName}'s policy`, achievedOutcome: outcome, nothingSent: "ASAP sent nothing itself: the request was approved and delivered by people.", premium: a ? adjustmentText(a) : "Any additional or return premium is finance's step on the Work item." },
  }, { onConflict: "run_id", ignoreDuplicates: true });
  const t = deriveTask(f.steps);
  await setWork(ctx, { task_status: t.status, task_party: t.party, task_since: t.status === "with_party" ? ctx.now.toISOString() : null, required_action: null, reason: null });
  return { kind: "done", output: { outcome }, evidence: [{ kind: "record", label: outcome }] };
}

export const ENDORSEMENT: WorkflowDefinition = {
  workflow: "endorsement",
  steps: [
    { key: "classify", label: "Request classified", run: classify },
    { key: "requirements", label: "Requirements checked", run: requirements },
    { key: "approval", label: "Request to the insurer approved by a person", run: approval },
    { key: "delivery", label: "Request delivered by a person", run: delivery },
    { key: "response", label: "Insurer's itemised answer awaited and chased", maxAttempts: 5, run: response },
    { key: "apply", label: "Confirmed changes applied by a person", run: apply },
    { key: "premium", label: "Premium adjustment recorded by a person", run: premium },
    { key: "finish", label: "Endorsement applied", run: finish },
  ],
};

async function startFor(db: SupabaseClient, organizationId: string, endorsementId: string): Promise<string | null> {
  const rule = await autonomyRule(db, organizationId);
  if (!automatic(rule.actions.prepare_endorsement)) return null;
  const r = await db.from("endorsements").select("id, work_item_id, policies(client_id)").eq("organization_id", organizationId).eq("id", endorsementId).maybeSingle();
  const row = r.data as unknown as { id: string; work_item_id: string; policies: { client_id: string } | null } | null;
  if (!row) return null;
  return (await startRun(db, ENDORSEMENT, { organizationId, subjectType: "endorsement", subjectId: row.id, workItemId: row.work_item_id, facts: { clientId: row.policies?.client_id ?? null, origin: "event" }, once: true })).runId;
}

const wake: EventHandler = async (db, _l, ev) => (ev.entity_id ? liveRunsOn(db, ev.organization_id, "endorsement", ev.entity_id) : []);

export const ENDORSEMENT_EVENTS: Partial<Record<string, EventHandler>> = {
  "endorsement.requested": async (db, _l, ev) => {
    const id = await startFor(db, ev.organization_id, ev.entity_id!);
    return id ? [id] : [];
  },
  "endorsement.changed": wake,
};
