import {
  decideApprovalRequestSchema,
  escalateRunRequestSchema,
  moveFollowUpRequestSchema,
  pauseRunRequestSchema,
  stopRunRequestSchema,
  supervisionResponseSchema,
  recordCommunicationDeliveryRequestSchema,
  setChasingRequestSchema,
  startRenewalRequestSchema,
  workflowActionResponseSchema,
  workflowDetailSchema,
  workflowListSchema,
  type WorkflowActionResponse,
  type WorkflowDetail,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { advanceRun, autonomyRule, detectRenewalFor, RENEWAL, RENEWAL_DEFAULTS, renewalWindow } from "../workflows/renewal.js";
import { load as loadRules } from "./rules.js";
import { renewalOperational } from "../workflows/renewal-view.js";
import { parseBody } from "./_parse.js";

/**
 * Workflow runs, for people (D-129). Reads go through the person's own session, so RLS decides
 * what they see. A person's decisions go through security-definer functions that need the server
 * key and the right permission and write the audit row. Then the engine — which writes with the
 * service connection, like the event consumers — continues the run at once; the event the decision
 * emitted makes it continue even if this process stops first.
 */

type RunDb = {
  id: string; organization_id: string; workflow: "renewal"; subject_id: string; work_item_id: string | null; state: string; current_step: string | null;
  exception: { code: string; message: string; needs: string; stepLabel?: string } | null; next_run_at: string; started_at: string; finished_at: string | null;
  facts: { clientId?: string; periodEnd?: string; startedBy?: string; origin?: string; [k: string]: unknown };
};

async function summaries(db: SupabaseClient, runs: RunDb[], can: { act: boolean; approve: boolean } = { act: true, approve: true }, now = new Date()) {
  const ids = runs.map((r) => r.id);
  const workIds = runs.map((r) => r.work_item_id).filter(Boolean) as string[];
  const clientIds = runs.map((r) => r.facts?.clientId).filter(Boolean) as string[];
  const orgId = runs[0]?.organization_id ?? null;
  const [steps, works, clients, approvals, comms, window] = await Promise.all([
    ids.length ? db.from("workflow_steps").select("run_id, step_key, state, output, finished_at").in("run_id", ids) : Promise.resolve({ data: [] }),
    workIds.length ? db.from("work_items").select("id, title, owner_id").in("id", workIds) : Promise.resolve({ data: [] }),
    clientIds.length ? db.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    ids.length ? db.from("workflow_approvals").select("run_id, state, decided_by, created_at").in("run_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ids.length ? db.from("prepared_communications").select("run_id, audience, state, party_name, quote_request_id").in("run_id", ids).neq("state", "superseded") : Promise.resolve({ data: [] }),
    orgId ? renewalWindow(db, orgId) : Promise.resolve({ ...RENEWAL_DEFAULTS }),
  ]);
  const st = (steps.data ?? []) as { run_id: string; step_key: string; state: string; output: Record<string, unknown>; finished_at: string | null }[];
  const workRows = new Map(((works.data ?? []) as { id: string; title: string; owner_id: string | null }[]).map((w) => [w.id, w]));
  const names = new Map(((clients.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const approvalRows = (approvals.data ?? []) as { run_id: string; state: string; decided_by: string | null }[];
  const commRows = (comms.data ?? []) as { run_id: string; audience: string; state: string; party_name: string; quote_request_id: string | null }[];
  const qrIds = commRows.map((m) => m.quote_request_id).filter(Boolean) as string[];
  const userIds = [
    ...[...workRows.values()].map((w) => w.owner_id),
    ...runs.map((r) => (typeof r.facts?.startedBy === "string" ? r.facts.startedBy : null)),
    ...approvalRows.map((a) => a.decided_by),
  ].filter(Boolean) as string[];
  const [users, deliveries] = await Promise.all([
    userIds.length ? db.from("users").select("id, display_name, full_name").in("id", [...new Set(userIds)]) : Promise.resolve({ data: [] }),
    qrIds.length ? db.from("quote_request_deliveries").select("quote_request_id, delivered_at, method").in("quote_request_id", qrIds) : Promise.resolve({ data: [] }),
  ]);
  const userName = new Map(((users.data ?? []) as { id: string; display_name: string | null; full_name: string | null }[]).map((u) => [u.id, u.display_name ?? u.full_name ?? "A member"]));
  const deliveryByQr = new Map(((deliveries.data ?? []) as { quote_request_id: string; delivered_at: string; method: string }[]).map((d) => [d.quote_request_id, d]));
  return runs.map((r) => {
    const mine = st.filter((s) => s.run_id === r.id);
    const clientId = r.facts?.clientId ?? null;
    const work = r.work_item_id ? workRows.get(r.work_item_id) : undefined;
    const owner = work?.owner_id ? { id: work.owner_id, name: userName.get(work.owner_id) ?? "A member" } : null;
    const myComms = commRows.filter((m) => m.run_id === r.id);
    const insurerQr = myComms.find((m) => m.audience === "insurer")?.quote_request_id ?? null;
    const delivery = insurerQr ? deliveryByQr.get(insurerQr) : undefined;
    const approval = approvalRows.find((a) => a.run_id === r.id) ?? null;
    const completeness = mine.find((s) => s.step_key === "completeness")?.output ?? {};
    const operational = renewalOperational({
      now,
      can,
      run: { state: r.state, currentStep: r.current_step, exception: r.exception, facts: (r.facts ?? {}) as Record<string, unknown>, startedAt: r.started_at },
      steps: mine.map((s) => ({ key: s.step_key, state: s.state, output: s.output ?? {}, finishedAt: s.finished_at })),
      approval: approval ? { state: approval.state, decidedByName: approval.decided_by ? (userName.get(approval.decided_by) ?? null) : null } : null,
      communications: myComms.map((m) => ({ audience: m.audience, state: m.state, partyName: m.party_name })),
      window,
      owner,
      startedByName: typeof r.facts?.startedBy === "string" ? (userName.get(r.facts.startedBy) ?? null) : null,
      periodEnd: r.facts?.periodEnd ?? null,
      insurerName: (completeness["insurerName"] as string | undefined) ?? myComms.find((m) => m.audience === "insurer")?.party_name ?? null,
      clientName: clientId ? (names.get(clientId) ?? null) : null,
      delivery: delivery ? { deliveredAt: delivery.delivered_at, method: delivery.method } : null,
    });
    return {
      id: r.id, workflow: r.workflow, subjectId: r.subject_id, workItemId: r.work_item_id, state: r.state as WorkflowDetail["state"], stateLabel: operational.status,
      currentStep: r.current_step, exception: r.exception, nextRunAt: r.next_run_at, startedAt: r.started_at, finishedAt: r.finished_at,
      title: work?.title || "Renewal",
      client: clientId && names.has(clientId) ? { id: clientId, name: names.get(clientId)! } : null,
      periodEnd: r.facts?.periodEnd ?? null,
      progress: { done: mine.filter((s) => s.state === "done" || s.state === "skipped").length, steps: mine.length },
      operational: { ...operational, owner },
    };
  });
}

export async function loadWorkflowDetail(db: SupabaseClient, runId: string, perms: { canApprove: boolean; canAct: boolean }): Promise<WorkflowDetail | null> {
  const r = await db.from("workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (!r.data) return null;
  const run = r.data as RunDb;
  const [summary] = await summaries(db, [run], { act: perms.canAct, approve: perms.canApprove });
  const [steps, approvals, comms] = await Promise.all([
    db.from("workflow_steps").select("step_key, position, label, state, attempts, next_attempt_at, finished_at, output, evidence, error").eq("run_id", runId).order("position"),
    db.from("workflow_approvals").select("id, title, state, bundle, bundle_sha256, decided_by, decided_at, note").eq("run_id", runId).order("created_at", { ascending: false }).limit(1),
    db.from("prepared_communications").select("id, audience, party_name, to_address, subject, body_text, state, quote_request_id, delivered_at, delivery_reference").eq("run_id", runId).neq("state", "superseded").order("audience"),
  ]);
  const a = ((approvals.data ?? []) as { id: string; title: string; state: string; bundle: Record<string, unknown>[]; bundle_sha256: string; decided_by: string | null; decided_at: string | null; note: string | null }[])[0] ?? null;
  let decidedByName: string | null = null;
  if (a?.decided_by) {
    const u = await db.from("users").select("display_name, full_name").eq("id", a.decided_by).maybeSingle();
    const row = u.data as { display_name: string | null; full_name: string | null } | null;
    decidedByName = row?.display_name ?? row?.full_name ?? "A member";
  }
  return workflowDetailSchema.parse({
    ...summary,
    steps: ((steps.data ?? []) as Record<string, unknown>[]).map((s) => ({
      key: s["step_key"], position: s["position"], label: s["label"], state: s["state"], attempts: s["attempts"], nextAttemptAt: s["next_attempt_at"],
      finishedAt: s["finished_at"], output: s["output"] ?? {}, evidence: s["evidence"] ?? [], error: s["error"],
    })),
    approval: a ? { id: a.id, title: a.title, state: a.state, bundle: a.bundle, bundleSha256: a.bundle_sha256, decidedByName, decidedAt: a.decided_at, note: a.note } : null,
    communications: ((comms.data ?? []) as Record<string, unknown>[]).map((m) => ({
      id: m["id"], audience: m["audience"], partyName: m["party_name"], toAddress: m["to_address"], subject: m["subject"], bodyText: m["body_text"],
      state: m["state"], quoteRequestId: m["quote_request_id"], deliveredAt: m["delivered_at"], deliveryReference: m["delivery_reference"],
    })),
    permissions: perms,
  });
}

export function workflowRoutes(deps: { logger: Logger; service: () => SupabaseClient }) {
  const app = new Hono();

  const perms = (ctx: Awaited<ReturnType<typeof resolveContext>>) => ({ canApprove: hasPermission(ctx, "email", "approve"), canAct: hasPermission(ctx, "space", "create") });
  /** Continue the run with the engine's own connection; a failure here leaves the event to finish it. */
  const advance = async (runId: string) => {
    try {
      await advanceRun(deps.service(), deps.logger, RENEWAL, runId);
    } catch (e) {
      deps.logger.warn({ runId, err: (e as Error).message }, "the run will continue on the next sweep");
    }
  };
  const respond = async (c: Context, db: SupabaseClient, runId: string, ctx: Awaited<ReturnType<typeof resolveContext>>, outcome: WorkflowActionResponse["outcome"], reason: string | null, status: 200 | 403 | 409 | 422 = 200) =>
    c.json(workflowActionResponseSchema.parse({ outcome, reason, run: await loadWorkflowDetail(db, runId, perms(ctx)) } satisfies WorkflowActionResponse), status);

  app.get("/workflows/renewals", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db.from("workflow_runs").select("*").eq("organization_id", org.id).eq("workflow", "renewal").order("next_run_at").limit(100);
    if (error) return sendError(c, mapDatabaseError(error));
    const p = perms(ctx);
    return c.json(workflowListSchema.parse({ runs: await summaries(db, (data ?? []) as RunDb[], { act: p.canAct, approve: p.canApprove }) }));
  });

  app.get("/workflows/runs/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    requireActiveOrganization(ctx);
    const detail = await loadWorkflowDetail(db, c.req.param("id"), perms(ctx));
    if (!detail) throw new HttpError(404, "not_found", "No run with that id");
    return c.json(detail);
  });

  app.get("/work-items/:id/workflow", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    requireActiveOrganization(ctx);
    const r = await db.from("workflow_runs").select("id").eq("work_item_id", c.req.param("id")).order("started_at", { ascending: false }).limit(1);
    const id = ((r.data ?? []) as { id: string }[])[0]?.id;
    return c.json({ run: id ? await loadWorkflowDetail(db, id, perms(ctx)) : null });
  });

  /** "Prepare Tausi's renewal": start now rather than waiting for the window. */
  app.post("/workflows/renewals", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, startRenewalRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "policy", "edit")) {
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.renewal.start", objectType: "policy_period", objectId: input.policyPeriodId, result: "denied", failureReason: "permission_denied" });
      throw new HttpError(403, "not_permitted", "Your role cannot start renewal work. Nothing was started.");
    }
    // Visible to this person under RLS, in their own brokerage — or it does not exist for them.
    const p = await db.from("policy_periods").select("id, organization_id").eq("id", input.policyPeriodId).eq("organization_id", org.id).maybeSingle();
    if (!p.data) throw new HttpError(404, "not_found", "No policy period with that id");
    const service = deps.service();
    const started = await detectRenewalFor(service, deps.logger, org.id, input.policyPeriodId, { kind: "manual", by: user.id });
    if ("blocked" in started) return c.json(workflowActionResponseSchema.parse({ outcome: "blocked", reason: started.blocked, run: null }), 409);
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.renewal.started_by_person", objectType: "workflow_run", objectId: started.runId, result: "success", newState: { created: started.created } });
    await advance(started.runId);
    return respond(c, db, started.runId, ctx, started.created ? "done" : "already", null, started.created ? 200 : 200);
  });

  app.post("/workflow-approvals/:id/decide", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, decideApprovalRequestSchema);
    const ctx = await resolveContext(db, user.id);
    requireActiveOrganization(ctx);
    const a = await db.from("workflow_approvals").select("run_id").eq("id", c.req.param("id")).maybeSingle();
    const runId = (a.data as { run_id: string } | null)?.run_id;
    if (!runId) throw new HttpError(404, "not_found", "No approval with that id");
    // The brokerage's autonomy rule may reserve approvals to administrators and the owner (D-131).
    const rule = await autonomyRule(db, requireActiveOrganization(ctx).id);
    if (rule.approver === "admin_or_owner" && !(ctx.activeMembership?.is_owner || ctx.activeMembership?.role.key === "brokerage_admin")) {
      await recordAudit(db, deps.logger, c, { organizationId: requireActiveOrganization(ctx).id, actorUserId: user.id, action: "workflow.approval.decided", objectType: "workflow_approval", objectId: c.req.param("id"), result: "denied", failureReason: "autonomy_rule_approver" });
      return respond(c, db, runId, ctx, "blocked", "This brokerage's rule reserves renewal approvals to an administrator or the owner. Nothing was approved.", 403);
    }
    const { data, error } = await db.rpc("workflow_approval_decide", { p_approval_id: c.req.param("id"), p_decision: input.decision, p_bundle_sha256: input.bundleSha256, p_note: input.note ?? null });
    if (error) {
      const m = error.message ?? "";
      if (m.includes("permission_denied")) return respond(c, db, runId, ctx, "blocked", "Your role cannot approve what leaves the brokerage. Nothing was approved.", 403);
      if (m.includes("bundle_changed")) return respond(c, db, runId, ctx, "blocked", "The bundle changed since you opened it. Nothing was approved — look at it again.", 409);
      if (m.includes("reason_required")) return respond(c, db, runId, ctx, "blocked", "Say why it is not approved, so it can be put right.", 422);
      return sendError(c, mapDatabaseError(error));
    }
    const changed = (data as { changed: boolean }).changed;
    if (changed) await advance(runId);
    return respond(c, db, runId, ctx, changed ? "done" : "already", null);
  });

  app.post("/prepared-communications/:id/delivery", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, recordCommunicationDeliveryRequestSchema);
    const ctx = await resolveContext(db, user.id);
    requireActiveOrganization(ctx);
    const m = await db.from("prepared_communications").select("run_id").eq("id", c.req.param("id")).maybeSingle();
    const runId = (m.data as { run_id: string } | null)?.run_id;
    if (!runId) throw new HttpError(404, "not_found", "No prepared message with that id");
    const { data, error } = await db.rpc("prepared_communication_record_delivery", { p_id: c.req.param("id"), p_method: input.method, p_reference: input.reference, p_delivered_at: input.deliveredAt ?? new Date().toISOString() });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("permission_denied")) return respond(c, db, runId, ctx, "blocked", "Your role cannot record deliveries. Nothing was recorded.", 403);
      if (msg.includes("not_approved")) return respond(c, db, runId, ctx, "blocked", "This message is not approved yet, so it cannot have been delivered.", 409);
      if (msg.includes("delivered_in_future")) return respond(c, db, runId, ctx, "blocked", "A delivery cannot be dated in the future.", 422);
      return sendError(c, mapDatabaseError(error));
    }
    const changed = (data as { changed: boolean }).changed;
    if (changed) await advance(runId);
    return respond(c, db, runId, ctx, changed ? "done" : "already", null);
  });

  /** After an exception is put right on the records, a person resumes the run at the failed step. */
  app.post("/workflows/runs/:id/resume", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const runId = c.req.param("id");
    const r = await db.from("workflow_runs").select("id, state, organization_id").eq("id", runId).eq("organization_id", org.id).maybeSingle();
    if (!r.data) throw new HttpError(404, "not_found", "No run with that id");
    if (!hasPermission(ctx, "policy", "edit")) {
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.resume", objectType: "workflow_run", objectId: runId, result: "denied", failureReason: "permission_denied" });
      return respond(c, db, runId, ctx, "blocked", "Your role cannot resume renewal work.", 403);
    }
    const service = deps.service();
    const now = new Date().toISOString();
    const full = await db.from("workflow_runs").select("facts").eq("id", runId).maybeSingle();
    const facts = ((full.data as { facts: Record<string, unknown> } | null)?.facts ?? {}) as Record<string, unknown>;
    if (facts["paused"]) {
      // Resuming a pause continues where it was: the same run, the same step. Only the request that
      // actually clears the pause records it — two clicks at once resume once.
      const cleared = await service.from("workflow_runs").update({ facts: { ...facts, paused: null }, next_run_at: now, updated_at: now }).eq("id", runId).not("facts->>paused", "is", null).select("id");
      if (!(cleared.data ?? []).length) return respond(c, db, runId, ctx, "already", null);
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.resumed", objectType: "workflow_run", objectId: runId, result: "success", previousState: { paused: true }, newState: { paused: false } });
      if ((r.data as { state: string }).state !== "exception") {
        await advance(runId);
        return respond(c, db, runId, ctx, "done", null);
      }
    }
    if ((r.data as { state: string }).state !== "exception") return respond(c, db, runId, ctx, "already", "The run is not stopped.");
    await service.from("workflow_steps").update({ state: "pending", attempts: 0, error: null, next_attempt_at: null, updated_at: now }).eq("run_id", runId).eq("state", "failed");
    await service.from("workflow_runs").update({ state: "running", exception: null, next_run_at: now, updated_at: now }).eq("id", runId).eq("state", "exception");
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.resumed", objectType: "workflow_run", objectId: runId, result: "success" });
    await advance(runId);
    return respond(c, db, runId, ctx, "done", null);
  });

  /**
   * The run's follow-up controls (D-131): "move the next follow-up to Friday" and "stop chasing this
   * insurer". Both write the run's facts, audit the person, and let the engine reschedule — the
   * same state Work, Today, the Space and Ask read. Escalation is never switched off.
   */
  const controlRun = async (c: Context, runId: string, action: string) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const r = await db.from("workflow_runs").select("id, state, current_step, facts, organization_id").eq("id", runId).eq("organization_id", org.id).maybeSingle();
    if (!r.data) throw new HttpError(404, "not_found", "No run with that id");
    if (!hasPermission(ctx, "policy", "edit")) {
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action, objectType: "workflow_run", objectId: runId, result: "denied", failureReason: "permission_denied" });
      return { blocked: await respond(c, db, runId, ctx, "blocked", "Your role cannot change renewal follow-ups.", 403) } as const;
    }
    return { db, user, ctx, org, run: r.data as { id: string; state: string; current_step: string | null; facts: Record<string, unknown> } } as const;
  };

  app.post("/workflows/runs/:id/follow-up", async (c) => {
    const input = await parseBody(c, moveFollowUpRequestSchema);
    const got = await controlRun(c, c.req.param("id"), "workflow.follow_up.moved");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    if (run.state === "done" || run.state === "cancelled") return respond(c, db, run.id, ctx, "blocked", "This renewal is finished — there is nothing to follow up.", 409);
    const today = new Date().toISOString().slice(0, 10);
    if (input.on < today) return respond(c, db, run.id, ctx, "blocked", "A follow-up cannot be moved into the past.", 422);
    if (run.facts["followUpOn"] === input.on) return respond(c, db, run.id, ctx, "already", null);
    const service = deps.service();
    const facts = { ...run.facts, followUpOn: input.on };
    await service.from("workflow_runs").update({ facts, updated_at: new Date().toISOString() }).eq("id", run.id);
    if (run.current_step === "await_terms") {
      const at = input.on + "T06:00:00.000Z";
      await service.from("workflow_steps").update({ next_attempt_at: at, updated_at: new Date().toISOString() }).eq("run_id", run.id).eq("step_key", "await_terms").eq("state", "waiting");
      await service.from("workflow_runs").update({ next_run_at: at }).eq("id", run.id).eq("state", "waiting_party");
    }
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.follow_up.moved", objectType: "workflow_run", objectId: run.id, result: "success", previousState: { followUpOn: run.facts["followUpOn"] ?? null }, newState: { followUpOn: input.on } });
    await advance(run.id);
    return respond(c, db, run.id, ctx, "done", null);
  });

  app.post("/workflows/runs/:id/chasing", async (c) => {
    const input = await parseBody(c, setChasingRequestSchema);
    const got = await controlRun(c, c.req.param("id"), input.stop ? "workflow.chasing.stopped" : "workflow.chasing.restarted");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    const was = Boolean((run.facts["chasing"] as { stopped?: boolean } | undefined)?.stopped);
    if (was === input.stop) return respond(c, db, run.id, ctx, "already", null);
    const u = await db.from("users").select("display_name, full_name").eq("id", user.id).maybeSingle();
    const byName = (u.data as { display_name: string | null; full_name: string | null } | null)?.display_name ?? (u.data as { full_name: string | null } | null)?.full_name ?? "A member";
    const facts = { ...run.facts, chasing: input.stop ? { stopped: true, by: user.id, byName, at: new Date().toISOString(), reason: input.reason ?? null } : { stopped: false } };
    const service = deps.service();
    await service.from("workflow_runs").update({ facts, updated_at: new Date().toISOString(), ...(run.state === "waiting_party" ? { next_run_at: new Date().toISOString() } : {}) }).eq("id", run.id);
    if (run.current_step === "await_terms") await service.from("workflow_steps").update({ next_attempt_at: new Date().toISOString() }).eq("run_id", run.id).eq("step_key", "await_terms").eq("state", "waiting");
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: input.stop ? "workflow.chasing.stopped" : "workflow.chasing.restarted", objectType: "workflow_run", objectId: run.id, result: "success", previousState: { stopped: was }, newState: { stopped: input.stop, reason: input.reason ?? null } });
    await advance(run.id);
    return respond(c, db, run.id, ctx, "done", null);
  });

  /** Pause: ASAP takes no further step on this run until a person resumes it. */
  app.post("/workflows/runs/:id/pause", async (c) => {
    const input = await parseBody(c, pauseRunRequestSchema);
    const got = await controlRun(c, c.req.param("id"), "workflow.paused");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    if (run.state === "done" || run.state === "cancelled") return respond(c, db, run.id, ctx, "blocked", "This renewal is finished — there is nothing to pause.", 409);
    if (run.facts["paused"]) return respond(c, db, run.id, ctx, "already", null);
    const byName = await nameOf(db, user.id);
    const set = await deps.service().from("workflow_runs").update({ facts: { ...run.facts, paused: { by: user.id, byName, at: new Date().toISOString(), reason: input.reason ?? null } }, updated_at: new Date().toISOString() }).eq("id", run.id).is("facts->>paused", null).select("id");
    if (!(set.data ?? []).length) return respond(c, db, run.id, ctx, "already", null);
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.paused", objectType: "workflow_run", objectId: run.id, result: "success", newState: { paused: true, reason: input.reason ?? null } });
    return respond(c, db, run.id, ctx, "done", null);
  });

  /** Escalate now: the work owner is asked to act, and Work and Today show it. */
  app.post("/workflows/runs/:id/escalate", async (c) => {
    const input = await parseBody(c, escalateRunRequestSchema);
    const got = await controlRun(c, c.req.param("id"), "workflow.escalated");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    if (run.state === "done" || run.state === "cancelled") return respond(c, db, run.id, ctx, "blocked", "This renewal is finished — there is nothing to escalate.", 409);
    if (run.facts["escalated"]) return respond(c, db, run.id, ctx, "already", null);
    const byName = await nameOf(db, user.id);
    const service = deps.service();
    const at = new Date().toISOString();
    const set = await service.from("workflow_runs").update({ facts: { ...run.facts, escalated: { by: user.id, byName, at, reason: input.reason } }, updated_at: at }).eq("id", run.id).is("facts->>escalated", null).select("id");
    if (!(set.data ?? []).length) return respond(c, db, run.id, ctx, "already", null);
    const w = await service.from("workflow_runs").select("work_item_id").eq("id", run.id).maybeSingle();
    const workItemId = (w.data as { work_item_id: string | null } | null)?.work_item_id;
    if (workItemId) {
      const cur = await service.from("work_items").select("version").eq("id", workItemId).maybeSingle();
      await service.from("work_items").update({ task_status: "needs_you", task_party: null, required_action: `Escalated by ${byName}: ${input.reason}`, version: ((cur.data as { version: number } | null)?.version ?? 1) + 1, updated_at: at }).eq("id", workItemId);
    }
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.escalated", objectType: "workflow_run", objectId: run.id, result: "success", newState: { reason: input.reason } });
    return respond(c, db, run.id, ctx, "done", null);
  });

  /** Follow up now: the next follow-up becomes due today and ASAP raises it at once. */
  app.post("/workflows/runs/:id/follow-up-now", async (c) => {
    const got = await controlRun(c, c.req.param("id"), "workflow.follow_up.now");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    if (run.current_step !== "await_terms") return respond(c, db, run.id, ctx, "blocked", "There is nothing to follow up yet — the insurer request has not been delivered.", 409);
    const service = deps.service();
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date(Date.now() - 1000).toISOString();
    await service.from("workflow_runs").update({ facts: { ...run.facts, followUpOn: today, chasing: { stopped: false } }, next_run_at: now, updated_at: now }).eq("id", run.id);
    await service.from("workflow_steps").update({ next_attempt_at: now }).eq("run_id", run.id).eq("step_key", "await_terms").eq("state", "waiting");
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.follow_up.now", objectType: "workflow_run", objectId: run.id, result: "success" });
    await advance(run.id);
    return respond(c, db, run.id, ctx, "done", null);
  });

  /** Stop automation: the run is cancelled; its Work stays open for a person, saying so. */
  app.post("/workflows/runs/:id/stop", async (c) => {
    const input = await parseBody(c, stopRunRequestSchema);
    const got = await controlRun(c, c.req.param("id"), "workflow.stopped");
    if ("blocked" in got) return got.blocked;
    const { db, user, ctx, org, run } = got;
    if (run.state === "done" || run.state === "cancelled") return respond(c, db, run.id, ctx, "already", null);
    const byName = await nameOf(db, user.id);
    const service = deps.service();
    const at = new Date().toISOString();
    await service.from("workflow_runs").update({ state: "cancelled", exception: null, finished_at: at, lease_until: null, facts: { ...run.facts, stopped: { by: user.id, byName, at, reason: input.reason } }, updated_at: at }).eq("id", run.id);
    const w = await service.from("workflow_runs").select("work_item_id").eq("id", run.id).maybeSingle();
    const workItemId = (w.data as { work_item_id: string | null } | null)?.work_item_id;
    if (workItemId) {
      const cur = await service.from("work_items").select("version").eq("id", workItemId).maybeSingle();
      await service.from("work_items").update({ task_status: "needs_you", task_party: null, required_action: `ASAP stopped working on this (${byName}: ${input.reason}) — a person carries it from here`, task_next_check: null, version: ((cur.data as { version: number } | null)?.version ?? 1) + 1, updated_at: at }).eq("id", workItemId);
    }
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.stopped", objectType: "workflow_run", objectId: run.id, result: "success", newState: { reason: input.reason } });
    return respond(c, db, run.id, ctx, "done", null);
  });

  /** A finished run's completion receipt. */
  app.get("/workflows/runs/:id/receipt", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    requireActiveOrganization(ctx);
    const r = await db.from("workflow_receipts").select("title, outcome, receipt, completed_at").eq("run_id", c.req.param("id")).maybeSingle();
    if (!r.data) throw new HttpError(404, "not_found", "This run has no receipt yet — it is not finished.");
    const row = r.data as { title: string; outcome: string; receipt: Record<string, unknown>; completed_at: string };
    return c.json({ title: row.title, outcome: row.outcome, completedAt: row.completed_at, receipt: row.receipt });
  });

  /**
   * Supervision (D-131): every workflow in this brokerage, grouped into the views people use, ranked
   * exception-first, with what ASAP plans to do next. One read of the same state as everything else.
   */
  app.get("/supervision", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db.from("workflow_runs").select("*").eq("organization_id", org.id).order("started_at", { ascending: false }).limit(200);
    if (error) return sendError(c, mapDatabaseError(error));
    const p = perms(ctx);
    const runs = await summaries(db, (data ?? []) as RunDb[], { act: p.canAct, approve: p.canApprove });
    const premiums = await premiumsFor(db, runs.map((r) => r.subjectId));
    const now = Date.now();
    const items = runs.map((r) => {
      const o = r.operational;
      const live = r.state !== "done" && r.state !== "cancelled";
      const views: ("needs_me" | "asap_handling" | "waiting_on_others" | "upcoming" | "done")[] = [];
      if (!live) views.push("done");
      else {
        if (o.attention && (!o.owner || o.owner.id === user.id)) views.push("needs_me");
        if (!o.attention && !o.paused && (r.state === "running" || o.tone === "waiting")) views.push("asap_handling");
        if (o.waitingFor) views.push("waiting_on_others");
        if (o.upcoming.length) views.push("upcoming");
      }
      // Exception-first: deadline, approval, blocked, overdue response, escalation, money at stake.
      const daysLeft = r.periodEnd ? Math.ceil((new Date(r.periodEnd + "T23:59:59Z").getTime() - now) / 86_400_000) : 999;
      let priority = 0;
      const reasons: string[] = [];
      if (live && daysLeft <= 14) { priority += 50; reasons.push(`cover ends in ${Math.max(daysLeft, 0)} days`); }
      else if (live && daysLeft <= 30) { priority += 20; reasons.push(`cover ends in ${daysLeft} days`); }
      if (o.escalated) { priority += 40; reasons.push("escalated"); }
      if (r.state === "exception") { priority += 35; reasons.push("blocked"); }
      if (r.state === "waiting_approval") { priority += 30; reasons.push("approval needed"); }
      if (o.attentionReason === "A follow-up is due") { priority += 25; reasons.push("insurer response overdue"); }
      if (o.primaryAction.kind === "record_delivery") { priority += 15; reasons.push("approved but not delivered"); }
      const premium = premiums.get(r.subjectId) ?? 0;
      if (premium >= 1_000_000) { priority += 10; reasons.push("large premium"); }
      if (!live) priority = -1;
      return { ...r, views, priority, priorityReason: reasons.join(" · ") || (live ? "on track" : "finished") };
    }).sort((a, b) => b.priority - a.priority);
    const upcoming = items.flatMap((r) => r.operational.upcoming.map((u) => ({ runId: r.id, title: r.title, kind: u.kind, at: u.at, label: u.label, paused: Boolean(r.operational.paused) }))).sort((a, b) => a.at.localeCompare(b.at));
    const counts = { needs_me: 0, asap_handling: 0, waiting_on_others: 0, upcoming: 0, done: 0 };
    for (const i of items) for (const v of i.views) counts[v]++;
    const rulesView = await loadRules(db, ctx, org.id);
    const rules = [
      ...rulesView.rules.filter((x) => x.key === "renewal.window" || x.key === "workflow.autonomy").map((x) => ({ key: x.key, summary: x.key === "renewal.window" ? summariseWindow(x.value) : "This brokerage's autonomy rule", version: x.version ?? null, setByName: x.setByName, source: x.source })),
      ...rulesView.defaults.filter((d) => d.key === "renewal.window" || d.key === "workflow.autonomy").map((d) => ({ key: d.key, summary: d.summary, version: null, setByName: null, source: d.basis })),
    ];
    return c.json(supervisionResponseSchema.parse({ items, upcoming, counts, rules }));
  });

  return app;
}

async function nameOf(db: SupabaseClient, userId: string) {
  const u = await db.from("users").select("display_name, full_name").eq("id", userId).maybeSingle();
  const row = u.data as { display_name: string | null; full_name: string | null } | null;
  return row?.display_name ?? row?.full_name ?? "A member";
}

async function premiumsFor(db: SupabaseClient, periodIds: string[]) {
  if (!periodIds.length) return new Map<string, number>();
  const { data } = await db.from("policy_periods").select("id, premium_amount").in("id", periodIds);
  return new Map(((data ?? []) as { id: string; premium_amount: string | null }[]).map((p) => [p.id, Number(p.premium_amount ?? 0)]));
}

function summariseWindow(v: unknown) {
  const w = v as { leadDays?: number; followUpDays?: number; escalateDaysBeforeExpiry?: number };
  return `Renewal work starts ${w.leadDays} days before expiry; follow up every ${w.followUpDays} days after delivery; escalate ${w.escalateDaysBeforeExpiry} days before expiry.`;
}
