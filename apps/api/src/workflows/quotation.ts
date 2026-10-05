import { chaseRuleSchema } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { generateComparison, loadComparisonView } from "../routes/comparisons.js";
import { loadOpportunity } from "../routes/opportunities.js";
import { workStateFrom } from "../quotation/next.js";
import { approveQuoteRequest, prepareQuoteRequest, quoteRequestDigest } from "../quotation/requests.js";
import { auditAutomation, sha256, startRun, type StepContext, type StepResult, type WorkflowDefinition } from "./engine.js";
import { autonomyRule, automatic } from "./renewal.js";
import { liveRunsOn, type EventHandler } from "./registry.js";
import { nextFollowUpAt, ruleOr } from "./rules.js";
import { systemReadContext } from "./system-context.js";

/**
 * The quotation workflow (D-141): from an opened opportunity to the options handed to a person.
 *
 * ASAP lists what the client still owes, uses the insurers a person chose (it never picks them),
 * prepares one request per insurer through the shared request path, asks for ONE approval of their
 * exact text, waits for each to be delivered, chases each insurer on the brokerage's cadence,
 * generates the comparison once every insurer has answered (or the deadline arrives with at least
 * one quote), and hands the options to a person. Only a person records the client's instruction;
 * when they do, this run finishes with a receipt and placement starts.
 *
 * Work is written from the same derivation the quotation Space reads (D-119), so a person and the
 * run never disagree about what is next.
 */

const DAY = 86_400_000;
export const QUOTE_CHASE_DEFAULT = { followUpDays: 3, deadlineDays: 10, escalateDaysBefore: 2 };
export const QUOTE_CHASE_BASIS =
  "ASAP's default — chase each insurer 3 days after the request reaches them, expect answers within 10 days of opening the quotation, escalate 2 days before — because this brokerage has not set a quotation chase rule.";

const human = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "not recorded";
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

type Opp = { id: string; client_id: string; work_item_id: string; title: string; class_of_business: string; risk_summary: string | null; cover_start: string | null; cover_end: string | null; owner_id: string | null; created_by: string; created_at: string; closed_at: string | null };
type Approach = { id: string; insurer_id: string; insurerName: string; request: { id: string; subject: string; body_text: string; approved_at: string | null; approved_by: string | null } | null; delivery: { delivered_at: string; method: string } | null; response: { id: string; outcome: string } | null };

async function opp(ctx: StepContext): Promise<Opp> {
  const o = await ctx.db.from("opportunities").select("id, client_id, work_item_id, title, class_of_business, risk_summary, cover_start, cover_end, owner_id, created_by, created_at, closed_at").eq("id", ctx.run.subject_id).maybeSingle();
  if (!o.data) throw new Error("The quotation this run is about can no longer be read.");
  return o.data as Opp;
}

/** Every insurer a person chose for this quotation, with its request, delivery and answer. */
async function approaches(db: SupabaseClient, organizationId: string, opportunityId: string): Promise<Approach[]> {
  const oi = await db.from("opportunity_insurers").select("id, insurer_id, insurers(name)").eq("organization_id", organizationId).eq("opportunity_id", opportunityId).is("removed_at", null).order("added_at");
  const rows = (oi.data ?? []) as unknown as { id: string; insurer_id: string; insurers: { name: string } | null }[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [qr, resp] = await Promise.all([
    db.from("quote_requests").select("id, opportunity_insurer_id, subject, body_text, approved_at, approved_by").in("opportunity_insurer_id", ids),
    db.from("insurer_responses").select("id, opportunity_insurer_id, outcome").in("opportunity_insurer_id", ids),
  ]);
  const reqs = (qr.data ?? []) as { id: string; opportunity_insurer_id: string; subject: string; body_text: string; approved_at: string | null; approved_by: string | null }[];
  const del = reqs.length ? await db.from("quote_request_deliveries").select("quote_request_id, delivered_at, method").in("quote_request_id", reqs.map((r) => r.id)) : { data: [] };
  const dels = (del.data ?? []) as { quote_request_id: string; delivered_at: string; method: string }[];
  const resps = (resp.data ?? []) as { id: string; opportunity_insurer_id: string; outcome: string }[];
  return rows.map((r) => {
    const request = reqs.find((q) => q.opportunity_insurer_id === r.id) ?? null;
    const response = resps.find((x) => x.opportunity_insurer_id === r.id && x.outcome !== "no_response") ?? null;
    return { id: r.id, insurer_id: r.insurer_id, insurerName: r.insurers?.name ?? "The insurer", request, delivery: request ? (dels.find((d) => d.quote_request_id === request.id) ?? null) : null, response };
  });
}

/** Work carries the same next action the quotation Space derives (D-119), written by the run. */
async function syncWork(ctx: StepContext, override?: Record<string, unknown>) {
  if (!ctx.run.work_item_id) return;
  const o = await loadOpportunity(ctx.db, systemReadContext(ctx.run.organization_id), ctx.run.organization_id, ctx.run.subject_id);
  const s = workStateFrom(o.next);
  const w = await ctx.db.from("work_items").select("version").eq("id", ctx.run.work_item_id).maybeSingle();
  const version = (w.data as { version: number } | null)?.version ?? 1;
  await ctx.db
    .from("work_items")
    .update({
      task_status: s.p_task_status, task_party: s.p_task_party, task_since: s.p_task_since, task_next_check: s.p_task_next_check,
      reason: s.p_reason, required_action: s.p_required_action, evidence_needed: s.p_evidence_needed,
      ...(override ?? {}), version: version + 1, updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.run.work_item_id);
}

async function chaseRule(db: SupabaseClient, organizationId: string) {
  return ruleOr(db, organizationId, "quote.chase", chaseRuleSchema, QUOTE_CHASE_DEFAULT, QUOTE_CHASE_BASIS);
}
/** The date answers are expected by: the rule's deadline from opening, and never after cover starts. */
function deadlineOf(o: Opp, deadlineDays: number): Date {
  const byRule = new Date(new Date(o.created_at).getTime() + deadlineDays * DAY);
  const beforeCover = o.cover_start ? new Date(new Date(o.cover_start + "T06:00:00Z").getTime() - DAY) : null;
  return beforeCover && beforeCover < byRule ? beforeCover : byRule;
}

/* ------------------------------------------------------------------------------------ steps */

async function requirements(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const r = await ctx.db.from("opportunity_requirements").select("label, required, supplied_at").eq("opportunity_id", o.id).order("position");
  const rows = (r.data ?? []) as { label: string; required: boolean; supplied_at: string | null }[];
  const outstanding = rows.filter((x) => x.required && !x.supplied_at).map((x) => x.label);
  const held = rows.filter((x) => x.supplied_at).map((x) => x.label);
  await syncWork(ctx);
  // Outstanding requirements do not stop preparing requests; they stand in front of delivery (D-119).
  return { kind: "done", output: { outstanding, held }, evidence: [{ kind: "record", label: outstanding.length ? `Still outstanding from the client: ${list(outstanding)}` : "Every required item is on file", ref: `opportunity:${o.id}` }] };
}

async function insurers(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const live = await approaches(ctx.db, ctx.run.organization_id, o.id);
  if (!live.length) {
    // ASAP never chooses insurers: a person adds them, and adding one wakes this run.
    await syncWork(ctx);
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to choose the insurers" } };
  }
  return { kind: "done", output: { insurers: live.map((a) => a.insurerName) }, evidence: live.map((a) => ({ kind: "record" as const, label: `${a.insurerName} — chosen by a person`, ref: `opportunity_insurer:${a.id}` })) };
}

function requestText(o: Opp, clientName: string, insurerName: string, held: string[], outstanding: string[]) {
  const subject = `Quotation request — ${clientName}, ${o.class_of_business}`;
  const body = [
    `Dear ${insurerName} underwriting,`,
    "",
    `Please quote for ${clientName}: ${o.title} (${o.class_of_business}).`,
    ...(o.risk_summary ? ["", `The risk: ${o.risk_summary}`] : []),
    ...(o.cover_start && o.cover_end ? ["", `Cover is needed from ${human(o.cover_start)} to ${human(o.cover_end)}.`] : []),
    ...(held.length ? ["", `Enclosed: ${list(held)}.`] : []),
    ...(outstanding.length ? ["", `To follow from the client: ${list(outstanding)}.`] : []),
    "",
    "Please give your premium, excess, limits, exclusions, conditions and how long the terms are valid.",
    "",
    "Kind regards",
  ].join("\n");
  return { subject, body };
}

async function prepareRequests(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const live = await approaches(ctx.db, ctx.run.organization_id, o.id);
  const missing = live.filter((a) => !a.request);
  const rule = await autonomyRule(ctx.db, ctx.run.organization_id);
  if (missing.length && !automatic(rule.actions.prepare_quotation)) {
    // The brokerage keeps preparation with people: wait for them to prepare each request.
    await syncWork(ctx);
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { waitingFor: "a person to prepare the requests", reason: "This brokerage's autonomy rule keeps quotation requests with people." } };
  }
  if (missing.length) {
    const cl = await ctx.db.from("clients").select("name").eq("id", o.client_id).maybeSingle();
    const clientName = (cl.data as { name: string } | null)?.name ?? "the client";
    const req = ctx.done["requirements"] ?? {};
    for (const a of missing) {
      const t = requestText(o, clientName, a.insurerName, (req["held"] as string[]) ?? [], (req["outstanding"] as string[]) ?? []);
      const p = await prepareQuoteRequest(ctx.db, { organizationId: ctx.run.organization_id, opportunityId: o.id, opportunityInsurerId: a.id, subject: t.subject, body: t.body, preparedBy: o.owner_id ?? o.created_by });
      if (p.outcome === "blocked") return { kind: "retry", error: p.reason };
    }
    await auditAutomation(ctx.db, ctx.run, "workflow.quotation.requests_prepared", { insurers: missing.length });
  }
  const now = await approaches(ctx.db, ctx.run.organization_id, o.id);
  return { kind: "done", output: { prepared: now.filter((a) => a.request).map((a) => a.request!.id) }, evidence: [{ kind: "communication", label: `${now.length} request${now.length === 1 ? "" : "s"} prepared — not sent` }] };
}

async function approval(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const live = (await approaches(ctx.db, ctx.run.organization_id, o.id)).filter((a) => a.request);
  // Approved one by one by a person on the quotation itself: the approval is already there.
  if (live.length && live.every((a) => a.request!.approved_at))
    return { kind: "done", output: { approvedBy: live[0]!.request!.approved_by, viaBundle: false }, evidence: live.map((a) => ({ kind: "approval" as const, label: `Request to ${a.insurerName} approved by a person`, ref: `quote_request:${a.request!.id}` })) };
  const existing = await ctx.db.from("workflow_approvals").select("id, state, decided_by, note, bundle").eq("run_id", ctx.run.id).eq("step_key", "approval").order("created_at", { ascending: false }).limit(1);
  const a = ((existing.data ?? []) as { id: string; state: string; decided_by: string | null; note: string | null; bundle: { quoteRequestId?: string; sha256?: string }[] }[])[0];
  if (a?.state === "approved") {
    // The person approved this exact content: each request carries that approval, digest checked.
    for (const item of a.bundle.filter((b) => b.quoteRequestId)) {
      const r = await approveQuoteRequest(ctx.db, { organizationId: ctx.run.organization_id, quoteRequestId: item.quoteRequestId!, approverId: a.decided_by!, ...(item.sha256 ? { expectedDigest: item.sha256 } : {}) });
      if (r.outcome === "blocked") return { kind: "exception", code: "request_changed", message: r.reason, needs: "Look at the request again; ASAP will ask for a fresh approval of the changed text when you resume." };
    }
    return { kind: "done", output: { approvalId: a.id, approvedBy: a.decided_by, viaBundle: true }, evidence: [{ kind: "approval", label: "Quotation requests approved by a person", ref: `workflow_approval:${a.id}` }] };
  }
  if (a?.state === "rejected")
    return { kind: "exception", code: "bundle_rejected", message: `The quotation requests were not approved${a.note ? `: ${a.note}` : ""}.`, needs: "Change the requests on the quotation, then resume — ASAP asks again for approval of the new text." };
  if (!a) {
    const bundle = live.filter((x) => !x.request!.approved_at).map((x) => ({
      kind: "communication", audience: "insurer", label: `Quotation request to ${x.insurerName}`, quoteRequestId: x.request!.id, to: null,
      deliveredBy: "You — no verified address is on file", subject: x.request!.subject, body: x.request!.body_text, sha256: quoteRequestDigest(x.request!.subject, x.request!.body_text),
    }));
    const cl = await ctx.db.from("clients").select("name").eq("id", o.client_id).maybeSingle();
    const ins = await ctx.db.from("workflow_approvals").insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, step_key: "approval", title: `Approve the quotation requests for ${(cl.data as { name: string } | null)?.name ?? "the client"}`, bundle, bundle_sha256: sha256(JSON.stringify(bundle)) }).select("id").maybeSingle();
    if (ins.error || !ins.data) return { kind: "retry", error: ins.error?.message ?? "approval not written" };
    const approvalId = (ins.data as { id: string }).id;
    // One prepared message per request, so delivery — by a person, or a connected mailbox — is recorded the same way as renewal's.
    await ctx.db.from("prepared_communications").insert(live.filter((x) => !x.request!.approved_at).map((x) => ({
      organization_id: ctx.run.organization_id, run_id: ctx.run.id, approval_id: approvalId, audience: "insurer", party_name: x.insurerName, to_address: null,
      subject: x.request!.subject, body_text: x.request!.body_text, body_sha256: sha256(x.request!.subject + "\n\n" + x.request!.body_text), quote_request_id: x.request!.id,
    })));
    await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Review and approve the quotation requests to ${list(live.map((x) => x.insurerName))}`, reason: "Nothing leaves the brokerage until a person approves its exact content." });
    await auditAutomation(ctx.db, ctx.run, "workflow.quotation.approval_requested", { approvalId, items: bundle.length });
  }
  return { kind: "wait", on: "approval", until: new Date(ctx.now.getTime() + DAY) };
}

async function delivery(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const live = (await approaches(ctx.db, ctx.run.organization_id, o.id)).filter((a) => a.request?.approved_at);
  const r = await ctx.db.from("opportunity_requirements").select("label, required, supplied_at").eq("opportunity_id", o.id);
  const outstanding = ((r.data ?? []) as { label: string; required: boolean; supplied_at: string | null }[]).filter((x) => x.required && !x.supplied_at).map((x) => x.label);
  const undelivered = live.filter((a) => !a.delivery);
  if (!undelivered.length) return { kind: "done", output: { delivered: live.map((a) => ({ opportunityInsurerId: a.id, insurer: a.insurerName, at: a.delivery!.delivered_at })) }, evidence: live.map((a) => ({ kind: "communication" as const, label: `Request delivered to ${a.insurerName} ${human(a.delivery!.delivered_at)} by ${a.delivery!.method.replaceAll("_", " ")}`, ref: `quote_request:${a.request!.id}` })) };
  if (outstanding.length) {
    // An insurer quotes on what the client gives: the client holds this step (D-119).
    const cl = await ctx.db.from("clients").select("name").eq("id", o.client_id).maybeSingle();
    const clientName = (cl.data as { name: string } | null)?.name ?? "The client";
    const since = (ctx.step.output["withClientSince"] as string | undefined) ?? ctx.now.toISOString();
    await syncWork(ctx, { task_status: "with_party", task_party: clientName, task_since: since, required_action: `Collect from ${clientName}: ${list(outstanding)} — then deliver the approved requests`, reason: "The requests are approved; an insurer quotes on what the client gives." });
    await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, withParty: clientName, withPartySince: since } }).eq("id", ctx.run.id);
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { withClientSince: since, outstanding } };
  }
  await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Deliver the approved request${undelivered.length === 1 ? "" : "s"} to ${list(undelivered.map((a) => a.insurerName))} and record how`, reason: "The requests are approved but not delivered — no mailbox is connected, so a person sends them." });
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { undelivered: undelivered.map((a) => a.insurerName) } };
}

async function awaitTerms(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const live = (await approaches(ctx.db, ctx.run.organization_id, o.id)).filter((a) => a.delivery);
  const rule = await chaseRule(ctx.db, ctx.run.organization_id);
  const autonomy = await autonomyRule(ctx.db, ctx.run.organization_id);
  const deadline = deadlineOf(o, rule.deadlineDays);
  const answered = live.filter((a) => a.response);
  const quoted = answered.filter((a) => a.response!.outcome === "quoted");
  const out = live.filter((a) => !a.response);
  if (!out.length || (ctx.now >= deadline && quoted.length))
    return { kind: "done", output: { answered: answered.map((a) => a.insurerName), quoted: quoted.map((a) => a.insurerName), unanswered: out.map((a) => a.insurerName), deadline: deadline.toISOString(), basis: rule.basis }, evidence: answered.map((a) => ({ kind: "response" as const, label: `${a.insurerName}: ${a.response!.outcome === "quoted" ? "quoted" : "declined"}`, ref: `insurer_response:${a.response!.id}` })) };
  if (ctx.now >= deadline)
    return { kind: "exception", code: "no_quotes_by_deadline", message: `No insurer has quoted by ${human(deadline)}${answered.length ? ` (${list(answered.map((a) => a.insurerName))} declined)` : ""}.`, needs: `Call ${list(out.map((a) => a.insurerName))}, or approach another insurer, and tell the client where things stand.` };

  // One cadence per insurer: each is chased on its own delivery date, never all at once.
  const followUps = (ctx.step.output["followUps"] as Record<string, number> | undefined) ?? {};
  const due = out.filter((a) => ctx.now >= nextFollowUpAt(a.delivery!.delivered_at, followUps[a.id] ?? 0, rule.followUpDays));
  const escalateAt = new Date(deadline.getTime() - rule.escalateDaysBefore * DAY);
  const escalated = Boolean(ctx.step.output["escalated"]);
  const earliest = out.map((a) => a.delivery!.delivered_at).sort()[0]!;
  const parties = list(out.map((a) => a.insurerName));
  await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, withParty: parties, withPartySince: earliest } }).eq("id", ctx.run.id);
  if (!escalated && ctx.now >= escalateAt && automatic(autonomy.actions.escalate)) {
    await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Answers are due ${human(deadline)} — no terms yet from ${parties}`, reason: `Escalated ${rule.escalateDaysBefore} days before the quotation deadline. ${rule.basis}` });
    await auditAutomation(ctx.db, ctx.run, "workflow.quotation.escalated", { outstanding: out.length, deadline: deadline.toISOString() });
    return { kind: "wait", on: "party", until: deadline, output: { followUps, escalated: true } };
  }
  if (due.length && automatic(autonomy.actions.follow_up)) {
    for (const a of due) followUps[a.id] = (followUps[a.id] ?? 0) + 1;
    await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Chase ${list(due.map((a) => `${a.insurerName} (follow-up ${followUps[a.id]})`))} for terms`, reason: `No terms ${rule.followUpDays * Math.max(...due.map((a) => followUps[a.id]!))} days after the request reached them. Answers are due ${human(deadline)}.`, task_next_check: new Date(ctx.now.getTime() + rule.followUpDays * DAY).toISOString() });
    await auditAutomation(ctx.db, ctx.run, "workflow.quotation.follow_up", { insurers: due.map((a) => a.insurerName), followUps: due.map((a) => followUps[a.id]) });
  } else if (!due.length && !escalated && !out.some((a) => followUps[a.id])) {
    // After a chase, the chase stays the next action until terms arrive or the next one is due.
    await syncWork(ctx, { task_status: "with_party", task_party: parties, task_since: earliest, task_next_check: [...out.map((a) => nextFollowUpAt(a.delivery!.delivered_at, followUps[a.id] ?? 0, rule.followUpDays)), escalateAt].sort((x, y) => x.getTime() - y.getTime())[0]!.toISOString() });
  }
  const next = [...out.map((a) => nextFollowUpAt(a.delivery!.delivered_at, followUps[a.id] ?? 0, rule.followUpDays)), escalateAt, deadline].filter((d) => d > ctx.now).sort((x, y) => x.getTime() - y.getTime())[0] ?? deadline;
  return { kind: "wait", on: "party", until: next, output: { followUps, escalated } };
}

async function compare(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const sys = systemReadContext(ctx.run.organization_id);
  const view = await loadComparisonView(ctx.db, sys, ctx.run.organization_id, o.id);
  const t = ctx.done["await_terms"] ?? {};
  const deadlinePassed = ctx.now >= new Date((t["deadline"] as string) ?? ctx.now.toISOString());
  if (view.comparison && !view.comparison.stale)
    return { kind: "done", output: { comparisonId: view.comparison.id, headline: view.comparison.recommendation.headline }, evidence: [{ kind: "record", label: `Comparison: ${view.comparison.recommendation.headline}`, ref: `opportunity:${o.id}` }] };
  if (!view.readiness.ready && !(deadlinePassed && view.readiness.quoted > 0)) {
    // The usual reason: terms a person has not confirmed yet (D-138). The run waits for them.
    await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: view.readiness.blockers[0] ?? "Confirm the insurers' terms so the comparison can be made", reason: "ASAP compares only terms a person has confirmed from the documents." });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { blockers: view.readiness.blockers } };
  }
  const made = await generateComparison(ctx.db, sys, ctx.run.organization_id, o.id, { runId: ctx.run.id }, view, new Date().toISOString());
  if (made.outcome === "blocked") return { kind: "exception", code: "comparison_blocked", message: made.reason, needs: "Record the insurer's answer again, then resume." };
  const after = await loadComparisonView(ctx.db, sys, ctx.run.organization_id, o.id);
  const headline = after.comparison?.recommendation.headline ?? "Comparison generated";
  await auditAutomation(ctx.db, ctx.run, "workflow.quotation.compared", { comparisonId: after.comparison?.id ?? null, quoted: view.readiness.quoted, recommendation: after.comparison?.recommendation.rule ? "by the brokerage's rule" : "none — no rule" });
  return { kind: "done", output: { comparisonId: after.comparison?.id ?? null, headline }, evidence: [{ kind: "record", label: `Comparison generated by ASAP: ${headline}`, ref: `opportunity:${o.id}` }] };
}

async function handOver(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const instr = await ctx.db.from("client_instructions").select("id, recorded_at").eq("opportunity_id", o.id).is("superseded_at", null).order("recorded_at", { ascending: false }).limit(1);
  const i = ((instr.data ?? []) as { id: string; recorded_at: string }[])[0];
  if (i) return { kind: "done", output: { clientInstructionId: i.id }, evidence: [{ kind: "record", label: "The client's instruction was recorded by a person", ref: `client_instruction:${i.id}` }] };
  const cl = await ctx.db.from("clients").select("name").eq("id", o.client_id).maybeSingle();
  const clientName = (cl.data as { name: string } | null)?.name ?? "the client";
  await syncWork(ctx, { task_status: "needs_you", task_party: null, task_since: null, required_action: `Present the options to ${clientName} and record their instruction`, reason: "The comparison is ready. Which insurer to take is the client's decision; a person records it." });
  return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + 3 * DAY), output: { presenting: true } };
}

async function finish(ctx: StepContext): Promise<StepResult> {
  const o = await opp(ctx);
  const cmp = ctx.done["compare"] ?? {};
  const appr = ctx.done["approval"] ?? {};
  const cl = await ctx.db.from("clients").select("name").eq("id", o.client_id).maybeSingle();
  const clientName = (cl.data as { name: string } | null)?.name ?? "the client";
  const live = await approaches(ctx.db, ctx.run.organization_id, o.id);
  const outcome = `Client instruction recorded — placement starts`;
  const receipt = {
    intendedOutcome: `Quotations for ${clientName}: ${o.title}`,
    achievedOutcome: outcome,
    dates: [{ label: "Quotation opened", at: o.created_at }, ...live.filter((a) => a.delivery).map((a) => ({ label: `Request delivered to ${a.insurerName}`, at: a.delivery!.delivered_at }))],
    approvals: appr["approvedBy"] ? [{ what: "Quotation requests", by: null, at: null }] : [],
    people: [],
    evidence: [String(cmp["headline"] ?? "")].filter(Boolean),
    delivery: live.filter((a) => a.delivery).map((a) => ({ to: a.insurerName, method: a.delivery!.method.replaceAll("_", " "), reference: "", at: a.delivery!.delivered_at })),
    unresolved: [],
    links: [{ label: "Quotation", ref: `opportunity:${o.id}` }, ...(ctx.run.work_item_id ? [{ label: "Work", ref: `work_item:${ctx.run.work_item_id}` }] : [])],
    nothingSent: "ASAP sent nothing itself: every request was approved by a person and delivered by a person or the connected mailbox.",
  };
  await ctx.db.from("workflow_receipts").upsert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "quotation", client_id: o.client_id, work_item_id: ctx.run.work_item_id, title: `Quotation — ${clientName}, ${o.title}`, outcome, receipt }, { onConflict: "run_id", ignoreDuplicates: true });
  await auditAutomation(ctx.db, ctx.run, "workflow.quotation.receipt", { outcome });
  return { kind: "done", output: { outcome }, evidence: [{ kind: "record", label: `Completion receipt: ${outcome}`, ref: `workflow_run:${ctx.run.id}` }] };
}

export const QUOTATION: WorkflowDefinition = {
  workflow: "quotation",
  steps: [
    { key: "requirements", label: "Requirements listed against what is held", run: requirements },
    { key: "insurers", label: "Insurers chosen by a person", run: insurers },
    { key: "prepare_requests", label: "One request prepared per insurer", run: prepareRequests },
    { key: "approval", label: "One approval for every request", run: approval },
    { key: "delivery", label: "Requests delivered", run: delivery },
    { key: "await_terms", label: "Each insurer's terms awaited and chased", maxAttempts: 5, run: awaitTerms },
    { key: "compare", label: "Comparison generated", run: compare },
    { key: "hand_over", label: "Options handed to a person to present", run: handOver },
    { key: "finish", label: "Client instruction recorded; placement starts", run: finish },
  ],
};

/** Starts the run for an opened opportunity, once — unless the brokerage keeps quotation work with people. */
export async function startQuotation(db: SupabaseClient, organizationId: string, opportunityId: string): Promise<string | null> {
  const rule = await autonomyRule(db, organizationId);
  if (!automatic(rule.actions.prepare_quotation)) return null;
  const o = await db.from("opportunities").select("id, work_item_id, client_id, closed_at").eq("organization_id", organizationId).eq("id", opportunityId).maybeSingle();
  const row = o.data as { id: string; work_item_id: string; client_id: string; closed_at: string | null } | null;
  if (!row || row.closed_at) return null;
  const s = await startRun(db, QUOTATION, { organizationId, subjectType: "opportunity", subjectId: row.id, workItemId: row.work_item_id, facts: { clientId: row.client_id, origin: "event" }, once: true });
  return s.runId;
}

const wake: EventHandler = async (db, _logger, ev) => (ev.entity_id ? liveRunsOn(db, ev.organization_id, "quotation", ev.entity_id) : []);
export const QUOTATION_EVENTS: Partial<Record<string, EventHandler>> = {
  "opportunity.opened": async (db, _logger: Logger, ev) => {
    const id = await startQuotation(db, ev.organization_id, ev.entity_id!);
    return id ? [id] : [];
  },
  "opportunity.changed": wake,
  "quote.received": wake,
  "client.instruction_recorded": async (db, _l, ev) => {
    const oppId = ev.payload?.["opportunityId"];
    return typeof oppId === "string" ? liveRunsOn(db, ev.organization_id, "quotation", oppId) : [];
  },
};
