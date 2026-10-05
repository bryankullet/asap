import { chaseRuleSchema, type PlacementResponse } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeIssuanceAction, loadIssuance } from "../placement/issuance.js";
import { executePlacementAction, load } from "../placement/service.js";
import { auditAutomation, startRun, type StepContext, type StepResult, type WorkflowDefinition } from "./engine.js";
import { autonomyRule, automatic } from "./renewal.js";
import { liveRunsOn, type EventHandler } from "./registry.js";
import { runEnv } from "./run-env.js";
import { nextFollowUpAt, ruleOr } from "./rules.js";
import { systemReadContext } from "./system-context.js";
import { filedEmails, recordFiledWork } from "./inbound.js";

/**
 * Placement and issuance on the engine (D-142), chained:
 *
 *   client.instruction_recorded → placement: prepare the request → a person approves → a person
 *   records it sent → ASAP chases the insurer → the cover check → a person decides any difference on
 *   the client's behalf → conditions resolved by a person → cover.confirmed
 *   cover.confirmed → issuance: prepare the request → approval → sent → ASAP chases for the policy,
 *   files the insurer's document when exactly one issuance fits it → readings reviewed by a person
 *   → ASAP runs the issued-policy check → a person resolves differences and applies → policy.issued.
 *
 * Every write goes through the placement and issuance services with the run as the actor and only
 * the permission the one action needs; approving, sending and applying stay with people. Work is
 * the placement's own (syncPlacementWork), brought into line by the service on every action.
 */

const DAY = 86_400_000;
const human = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "not recorded";

export const PLACEMENT_CHASE_DEFAULT = { followUpDays: 3, deadlineDays: 7, escalateDaysBefore: 2 };
export const PLACEMENT_CHASE_BASIS = "ASAP's default — chase the insurer 3 days after the request is sent, expect confirmation within 7 days, escalate 2 days before — because this brokerage has not set a placement chase rule.";
export const ISSUANCE_CHASE_DEFAULT = { followUpDays: 5, deadlineDays: 21, escalateDaysBefore: 5 };
export const ISSUANCE_CHASE_BASIS = "ASAP's default — chase the insurer 5 days after the issuance request is sent, expect the policy within 21 days, escalate 5 days before — because this brokerage has not set an issuance chase rule.";

const view = (ctx: StepContext) => load(ctx.db, systemReadContext(ctx.run.organization_id), ctx.run.organization_id, ctx.run.subject_id, { sync: true });

async function setWork(ctx: StepContext, patch: Record<string, unknown>) {
  if (!ctx.run.work_item_id) return;
  const w = await ctx.db.from("work_items").select("version").eq("id", ctx.run.work_item_id).maybeSingle();
  await ctx.db.from("work_items").update({ ...patch, version: ((w.data as { version: number } | null)?.version ?? 1) + 1, updated_at: new Date().toISOString() }).eq("id", ctx.run.work_item_id);
}

/** Chase one outside party on the brokerage's cadence: follow-ups recorded in the step, escalation once. */
async function chase(ctx: StepContext, o: { party: string; sentAt: string; key: string; deadline: Date; rule: { followUpDays: number; escalateDaysBefore: number; basis: string }; what: string }): Promise<StepResult> {
  const filed = filedEmails(ctx);
  if (filed.length) {
    await setWork(ctx, recordFiledWork(filed[0]!, o.what === "Cover confirmation" ? "the cover confirmation or answer" : "the policy or answer"));
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY) };
  }
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const followUps = Number(ctx.step.output["followUps"] ?? 0);
  const escalated = Boolean(ctx.step.output["escalated"]);
  const nextAt = nextFollowUpAt(o.sentAt, followUps, o.rule.followUpDays);
  const escalateAt = new Date(o.deadline.getTime() - o.rule.escalateDaysBefore * DAY);
  await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, withParty: o.party, withPartySince: o.sentAt } }).eq("id", ctx.run.id);
  if (!escalated && ctx.now >= escalateAt && automatic(autonomy.actions.escalate)) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `${o.what} is due ${human(o.deadline)} — nothing yet from ${o.party}`, reason: `Escalated ${o.rule.escalateDaysBefore} days before it is due. ${o.rule.basis}` });
    await auditAutomation(ctx.db, ctx.run, `workflow.${ctx.run.workflow}.escalated`, { party: o.party, deadline: o.deadline.toISOString() });
    return { kind: "wait", on: "party", until: new Date(Math.max(o.deadline.getTime(), ctx.now.getTime() + DAY)), output: { followUps, escalated: true } };
  }
  if (ctx.now >= nextAt && automatic(autonomy.actions.follow_up)) {
    const n = followUps + 1;
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Chase ${o.party} for ${o.what.toLowerCase()} (follow-up ${n})`, reason: `Sent ${human(o.sentAt)}; nothing back after ${n * o.rule.followUpDays} days.`, task_next_check: new Date(ctx.now.getTime() + o.rule.followUpDays * DAY).toISOString() });
    await auditAutomation(ctx.db, ctx.run, `workflow.${ctx.run.workflow}.follow_up`, { party: o.party, followUp: n });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + o.rule.followUpDays * DAY), output: { followUps: n, escalated } };
  }
  if (followUps === 0 && !escalated) await setWork(ctx, { task_status: "with_party", task_party: o.party, task_since: o.sentAt, task_next_check: nextAt.toISOString() });
  return { kind: "wait", on: "party", until: [nextAt, escalateAt].filter((d) => d > ctx.now).sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(ctx.now.getTime() + DAY), output: { followUps, escalated } };
}

/* ------------------------------------------------------------------------------ placement */

function requestText(v: PlacementResponse) {
  const b = v.basis;
  const cover = [b.classOfBusiness ?? v.opportunity.classOfBusiness, b.subject].filter(Boolean).join(" — ");
  const subject = `Placement instruction — ${v.client.name}, ${v.opportunity.classOfBusiness}`;
  const body = [
    `Dear ${v.insurer.name} underwriting,`,
    "",
    `${v.client.name} accepts your quotation and instructs us to place cover on the quoted terms${b.premiumAmount ? ` (premium ${b.premiumCurrency ?? ""} ${Number(b.premiumAmount).toLocaleString("en-KE")})`.replace("  ", " ") : ""}.`,
    `Cover from ${human(v.placement.requestedEffectiveAt)}${b.expiryAt ? ` to ${human(b.expiryAt)}` : ""}.`,
    ...(b.clientConditions ? ["", `The client's conditions: ${b.clientConditions}`] : []),
    "",
    "Please confirm cover in writing, with your reference.",
    "",
    "Kind regards",
  ].join("\n");
  return { subject, body, coverRequested: cover || v.opportunity.classOfBusiness, outstandingConditions: v.conditions.filter((c) => c.state === "unresolved").map((c) => c.text).join("; ") || undefined };
}

async function prepare(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  if (v.request) return { kind: "done", output: { placementRequestId: v.request.id, version: v.request.version }, evidence: [{ kind: "record", label: `Placement request v${v.request.version} prepared${v.request.preparedByName ? ` by ${v.request.preparedByName}` : ""} — not sent`, ref: `placement:${v.placement.id}` }] };
  const cl = await ctx.db.from("clients").select("file_status").eq("id", v.client.id).maybeSingle();
  const fileStatus = (cl.data as { file_status: string } | null)?.file_status ?? "unknown";
  if (fileStatus !== "cleared") {
    // file_blocks_placement: the client's file must be cleared before cover is placed.
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Clear ${v.client.name}'s file before placing cover`, reason: `The client's file is ${fileStatus.replaceAll("_", " ")}, and it is blocking this placement.` });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { blockedBy: "client_file", fileStatus } };
  }
  if (v.drift.stale) return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { blockedBy: "drift" } };
  const rule = await autonomyRule(ctx.db, ctx.run.organization_id);
  if (!automatic(rule.actions.prepare_placement)) return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to prepare the placement request" } };
  const t = requestText(v);
  const out = await executePlacementAction(runEnv(ctx, ["placement:edit"]), v.placement.id, { action: "prepare_request", subject: t.subject, body: t.body, coverRequested: t.coverRequested, ...(t.outstandingConditions ? { outstandingConditions: t.outstandingConditions } : {}) });
  if (out.outcome === "blocked") return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { blockedBy: out.reason } };
  const after = await view(ctx);
  return { kind: "done", output: { placementRequestId: after.request?.id ?? null, version: after.request?.version ?? null }, evidence: [{ kind: "record", label: "Placement request prepared by ASAP — not sent", ref: `placement:${v.placement.id}` }] };
}

async function approvalP(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  if (v.request?.approval) return { kind: "done", output: { approvedBy: v.request.approval.approvedByName }, evidence: [{ kind: "approval", label: `Placement request approved by ${v.request.approval.approvedByName ?? "a person"}` }] };
  // A person approves the exact version on the placement; the run waits for them.
  return { kind: "wait", on: "approval", until: new Date(ctx.now.getTime() + DAY) };
}

async function submission(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  if (v.request?.submission) return { kind: "done", output: { sentAt: v.request.submission.sentAt, recipient: v.request.submission.recipient }, evidence: [{ kind: "communication", label: `Sent to ${v.request.submission.recipient} ${human(v.request.submission.sentAt)} by ${v.request.submission.recordedByName ?? "a person"}` }] };
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to send the approved request and record it" } };
}

async function confirmation(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  const ir = v.insurerResponse;
  if (ir?.outcome === "declined") return { kind: "exception", code: "insurer_declined", message: `${v.insurer.name} declined to place cover for ${v.client.name}.`, needs: `Tell ${v.client.name}, and go back to the other quotations or approach another insurer.` };
  if (ir && ir.outcome.startsWith("confirmed")) return { kind: "done", output: { outcome: ir.outcome, receivedAt: ir.receivedAt }, evidence: [{ kind: "response", label: `${v.insurer.name} ${ir.outcome === "confirmed_with_changes" ? "confirmed cover with changes" : "confirmed cover as requested"}${ir.insurerReference ? `, reference ${ir.insurerReference}` : ""}` }] };
  if (ir?.outcome === "more_information_required") {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `${v.insurer.name} needs more information before confirming`, reason: ir.informationRequired ?? "The insurer asked for more information." });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { moreInformation: true } };
  }
  const sentAt = ctx.done["submission"]?.["sentAt"] as string;
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "placement.chase", chaseRuleSchema, PLACEMENT_CHASE_DEFAULT, PLACEMENT_CHASE_BASIS);
  const byRule = new Date(new Date(sentAt).getTime() + rule.deadlineDays * DAY);
  const effective = new Date(v.placement.requestedEffectiveAt);
  return chase(ctx, { party: v.insurer.name, sentAt, key: "confirmation", deadline: effective < byRule && effective > new Date(sentAt) ? effective : byRule, rule, what: "Cover confirmation" });
}

async function coverCheck(ctx: StepContext): Promise<StepResult> {
  let v = await view(ctx);
  if (!v.coverMatch?.current) {
    const out = await executePlacementAction(runEnv(ctx, ["placement:edit"]), v.placement.id, { action: "verify_cover_match" });
    if (out.outcome === "blocked") return { kind: "retry", error: out.reason ?? "the cover check could not run" };
    v = await view(ctx);
  }
  const m = v.coverMatch;
  if (m && m.current && m.materialDifferences === 0 && m.unclearCount === 0) return { kind: "done", output: { coverMatchId: m.id }, evidence: [{ kind: "record", label: "The insurer's confirmation matches what the client accepted", ref: `placement:${v.placement.id}` }] };
  // A difference is accepted, or not, on the client's behalf by a person. Never by ASAP.
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { differences: m?.materialDifferences ?? null, unclear: m?.unclearCount ?? null } };
}

async function conditions(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  const open = v.conditions.filter((c) => c.state === "unresolved");
  if (!open.length) return { kind: "done", output: { conditions: v.conditions.length }, evidence: v.conditions.map((c) => ({ kind: "record" as const, label: `${c.text}: ${c.state.replaceAll("_", " ")}${c.resolvedByName ? ` (${c.resolvedByName})` : ""}` })) };
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { unresolved: open.map((c) => c.text) } };
}

async function finishPlacement(ctx: StepContext): Promise<StepResult> {
  const v = await view(ctx);
  if (v.cover.state !== "confirmed" && v.cover.state !== "active") return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { cover: v.cover.state } };
  const outcome = `Cover confirmed by ${v.insurer.name} — issuance starts`;
  await ctx.db.from("workflow_receipts").upsert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "placement", client_id: v.client.id, work_item_id: ctx.run.work_item_id, title: `Placement — ${v.client.name}, ${v.opportunity.title}`, outcome, receipt: { intendedOutcome: `Cover for ${v.client.name} with ${v.insurer.name}`, achievedOutcome: outcome, cover: v.cover.line, nothingSent: "ASAP sent nothing itself: the request was approved and sent by people." } }, { onConflict: "run_id", ignoreDuplicates: true });
  return { kind: "done", output: { outcome }, evidence: [{ kind: "record", label: v.cover.line }] };
}

export const PLACEMENT: WorkflowDefinition = {
  workflow: "placement",
  steps: [
    { key: "prepare", label: "Placement request prepared", run: prepare },
    { key: "approval", label: "Request approved by a person", run: approvalP },
    { key: "submission", label: "Request sent by a person", run: submission },
    { key: "confirmation", label: "Insurer's confirmation awaited and chased", maxAttempts: 5, run: confirmation },
    { key: "cover_check", label: "Cover checked against what the client accepted", run: coverCheck },
    { key: "conditions", label: "The client's conditions resolved", run: conditions },
    { key: "finish", label: "Cover confirmed; issuance starts", run: finishPlacement },
  ],
};

/* ------------------------------------------------------------------------------ issuance */

const STAGES = ["not_ready", "ready", "approval_required", "submission_required", "with_insurer", "review_required", "differences_to_resolve", "ready_to_apply", "applied"] as const;
const past = (stage: string, than: (typeof STAGES)[number]) => STAGES.indexOf(stage as (typeof STAGES)[number]) > STAGES.indexOf(than);
// Read with the one permission the run may use, so readiness is judged as for the step that acts.
const issuance = (ctx: StepContext) => loadIssuance(runEnv(ctx, ["placement:edit"]), ctx.run.subject_id);

async function prepareIssuance(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  if (past(i.stage, "ready")) return { kind: "done", output: { stage: i.stage } };
  if (i.stage === "not_ready") return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { reasons: i.readiness.reasons.map((r) => r.message) } };
  const rule = await autonomyRule(ctx.db, ctx.run.organization_id);
  if (!automatic(rule.actions.prepare_placement)) return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to prepare the issuance request" } };
  const out = await executeIssuanceAction(runEnv(ctx, ["placement:edit"]), ctx.run.subject_id, { action: "prepare_issuance_request", requiredDocuments: [] });
  if (out.outcome === "blocked") return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { blockedBy: out.reason } };
  return { kind: "done", output: { prepared: true }, evidence: [{ kind: "record", label: "Issuance request prepared by ASAP — not sent" }] };
}
async function approvalI(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  return past(i.stage, "approval_required") ? { kind: "done", output: { stage: i.stage }, evidence: [{ kind: "approval", label: "Issuance request approved by a person" }] } : { kind: "wait", on: "approval", until: new Date(ctx.now.getTime() + DAY) };
}
async function submissionI(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  if (past(i.stage, "submission_required")) {
    const s = await ctx.db.from("issuance_submissions").select("sent_at, recipient, issuance_requests!inner(placement_id)").eq("issuance_requests.placement_id", ctx.run.subject_id).order("sent_at", { ascending: false }).limit(1);
    const row = ((s.data ?? []) as unknown as { sent_at: string; recipient: string }[])[0];
    return { kind: "done", output: { sentAt: row?.sent_at ?? ctx.now.toISOString(), recipient: row?.recipient ?? null }, evidence: [{ kind: "communication", label: `Issuance request sent${row ? ` to ${row.recipient} ${human(row.sent_at)}` : ""} by a person` }] };
  }
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY) };
}
async function policyDocument(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  if (past(i.stage, "with_insurer")) return { kind: "done", output: { documents: i.documents.length }, evidence: [{ kind: "document", label: "The insurer's policy document is on file" }] };
  const proposed = (ctx.run.facts["proposedDocuments"] as string[] | undefined) ?? [];
  if (proposed.length) {
    await setWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Confirm which document is ${i.insurer.name}'s issued policy for ${i.client.name}`, reason: `${proposed.length} document${proposed.length === 1 ? "" : "s"} could be it, and more than one placement could be waiting for it — a person confirms the match.` });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { proposed } };
  }
  const sentAt = (ctx.done["submission"]?.["sentAt"] as string) ?? ctx.now.toISOString();
  const rule = await ruleOr(ctx.db, ctx.run.organization_id, "issuance.chase", chaseRuleSchema, ISSUANCE_CHASE_DEFAULT, ISSUANCE_CHASE_BASIS);
  return chase(ctx, { party: i.insurer.name, sentAt, key: "policy", deadline: new Date(new Date(sentAt).getTime() + rule.deadlineDays * DAY), rule, what: "The issued policy" });
}
async function reviewAndCheck(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  if (past(i.stage, "review_required")) return { kind: "done", output: { stage: i.stage }, evidence: [{ kind: "record", label: "Readings reviewed by a person; the issued-policy check is run" }] };
  // Once a person has reviewed every reading, the check runs on its own — the same check a person runs.
  const out = await executeIssuanceAction(runEnv(ctx, ["placement:edit"]), ctx.run.subject_id, { action: "run_issued_policy_check" });
  if (out.outcome !== "blocked") {
    const after = await issuance(ctx);
    if (past(after.stage, "review_required")) return { kind: "done", output: { stage: after.stage, check: out.receipt }, evidence: [{ kind: "record", label: out.receipt ?? "Issued-policy check run" }] };
  }
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to review the values read from the policy document" } };
}
async function differences(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  return past(i.stage, "differences_to_resolve") ? { kind: "done", output: { stage: i.stage } } : { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to resolve each difference" } };
}
async function apply(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  return i.stage === "applied" ? { kind: "done", output: { stage: i.stage }, evidence: [{ kind: "record", label: "Applied to the policy record by a person" }] } : { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to apply the issued policy" } };
}
async function finishIssuance(ctx: StepContext): Promise<StepResult> {
  const i = await issuance(ctx);
  const outcome = `Policy issued by ${i.insurer.name} and on the record`;
  await ctx.db.from("workflow_receipts").upsert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "issuance", client_id: i.client.id, work_item_id: ctx.run.work_item_id, title: `Policy issue — ${i.client.name}, ${i.placement.title}`, outcome, receipt: { intendedOutcome: `${i.insurer.name}'s issued policy for ${i.client.name} on the record`, achievedOutcome: outcome, nothingSent: "ASAP sent nothing itself: the request was approved and sent by people, and a person applied the policy." } }, { onConflict: "run_id", ignoreDuplicates: true });
  await auditAutomation(ctx.db, ctx.run, "workflow.issuance.receipt", { outcome });
  return { kind: "done", output: { outcome } };
}

export const ISSUANCE: WorkflowDefinition = {
  workflow: "issuance",
  steps: [
    { key: "prepare", label: "Issuance request prepared", run: prepareIssuance },
    { key: "approval", label: "Request approved by a person", run: approvalI },
    { key: "submission", label: "Request sent by a person", run: submissionI },
    { key: "policy_document", label: "Issued policy awaited and chased", maxAttempts: 5, run: policyDocument },
    { key: "review_and_check", label: "Readings reviewed; issued-policy check run", run: reviewAndCheck },
    { key: "differences", label: "Differences resolved by a person", run: differences },
    { key: "apply", label: "Applied to the policy record by a person", run: apply },
    { key: "finish", label: "Policy issued", run: finishIssuance },
  ],
};

/* ------------------------------------------------------------------------------ chaining */

async function startFor(db: SupabaseClient, def: WorkflowDefinition, organizationId: string, placementId: string): Promise<string | null> {
  const rule = await autonomyRule(db, organizationId);
  if (!automatic(rule.actions.prepare_placement)) return null;
  const p = await db.from("placements").select("id, work_item_id, client_id").eq("organization_id", organizationId).eq("id", placementId).maybeSingle();
  const row = p.data as { id: string; work_item_id: string | null; client_id: string } | null;
  if (!row) return null;
  return (await startRun(db, def, { organizationId, subjectType: "placement", subjectId: row.id, workItemId: row.work_item_id, facts: { clientId: row.client_id, origin: "event" }, once: true })).runId;
}

const wakeOn = (workflow: string): EventHandler => async (db, _l, ev) => (ev.entity_id ? liveRunsOn(db, ev.organization_id, workflow, ev.entity_id) : []);

export const PLACEMENT_EVENTS: Partial<Record<string, EventHandler>> = {
  "client.instruction_recorded": async (db, _l, ev) => {
    const id = await startFor(db, PLACEMENT, ev.organization_id, ev.entity_id!);
    return id ? [id] : [];
  },
  "placement.changed": wakeOn("placement"),
  "cover.confirmed": wakeOn("placement"),
};

const comparable = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(limited|ltd|plc|insurance|assurance|company|co|kenya|general|the|simulated)\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * A document read that may be an insurer's issued policy (D-142): matched to the issuance runs
 * waiting for one. Exactly one fitting on client, insurer and class is filed to it by the run, with
 * the same action a person uses; anything else is proposed and a person confirms.
 */
async function documentRead(db: SupabaseClient, _l: unknown, ev: { organization_id: string; entity_id: string | null; payload: Record<string, unknown> | null }): Promise<string[]> {
  const kind = ev.payload?.["kind"];
  if (!ev.entity_id || !["policy_schedule", "certificate", "other"].includes(String(kind))) return [];
  const runs = await db.from("workflow_runs").select("id, subject_id, facts").eq("organization_id", ev.organization_id).eq("workflow", "issuance").eq("current_step", "policy_document").not("state", "in", "(done,cancelled,exception)");
  const waiting = (runs.data ?? []) as { id: string; subject_id: string; facts: Record<string, unknown> }[];
  if (!waiting.length) return [];
  const doc = await db.from("documents").select("id, client_id, kind").eq("id", ev.entity_id).maybeSingle();
  const d = doc.data as { id: string; client_id: string | null; kind: string } | null;
  if (!d) return [];
  const f = await db.from("document_fields").select("field_key, proposed_value, corrected_value").eq("document_id", d.id);
  const val = (k: string) => { const r = ((f.data ?? []) as { field_key: string; proposed_value: string | null; corrected_value: string | null }[]).find((x) => x.field_key === k); return r ? (r.corrected_value ?? r.proposed_value) : null; };
  const fits: { id: string; subject_id: string; facts: Record<string, unknown> }[] = [];
  for (const r of waiting) {
    const p = await db.from("placements").select("client_id, insurer_id, opportunity_id, clients(name), insurers(name), opportunities(class_of_business)").eq("id", r.subject_id).maybeSingle();
    const row = p.data as unknown as { client_id: string; clients: { name: string } | null; insurers: { name: string } | null; opportunities: { class_of_business: string } | null } | null;
    if (!row) continue;
    const clientOk = d.client_id ? d.client_id === row.client_id : comparable(val("insured_name")) !== "" && comparable(val("insured_name")) === comparable(row.clients?.name);
    const insurerOk = comparable(val("insurer_name")) !== "" && comparable(val("insurer_name")) === comparable(row.insurers?.name);
    const cls = comparable(val("class_of_business"));
    const classOk = cls === "" || comparable(row.opportunities?.class_of_business).split(" ").some((w) => w.length > 3 && cls.includes(w));
    if (clientOk && insurerOk && classOk) fits.push(r);
  }
  if (fits.length === 1) {
    const r = fits[0]!;
    const fakeCtx = { db, run: { id: r.id, organization_id: ev.organization_id } } as unknown as StepContext;
    await executeIssuanceAction(runEnv(fakeCtx, ["placement:edit"]), r.subject_id, { action: "record_issued_policy_document", documentId: d.id, receivedAt: new Date().toISOString() });
    return [r.id];
  }
  for (const r of fits) {
    const proposed = [...new Set([...((r.facts["proposedDocuments"] as string[] | undefined) ?? []), d.id])];
    await db.from("workflow_runs").update({ facts: { ...r.facts, proposedDocuments: proposed } }).eq("id", r.id);
  }
  return fits.map((r) => r.id);
}

export const ISSUANCE_EVENTS: Partial<Record<string, EventHandler>> = {
  "cover.confirmed": async (db, _l, ev) => {
    const id = await startFor(db, ISSUANCE, ev.organization_id, ev.entity_id!);
    return id ? [id] : [];
  },
  "placement.changed": wakeOn("issuance"),
  "document.read": documentRead as EventHandler,
};
