import {
  decideApprovalRequestSchema,
  recordCommunicationDeliveryRequestSchema,
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
import { advanceRun, detectRenewalFor, RENEWAL } from "../workflows/renewal.js";
import { parseBody } from "./_parse.js";

/**
 * Workflow runs, for people (D-129). Reads go through the person's own session, so RLS decides
 * what they see. A person's decisions go through security-definer functions that need the server
 * key and the right permission and write the audit row. Then the engine — which writes with the
 * service connection, like the event consumers — continues the run at once; the event the decision
 * emitted makes it continue even if this process stops first.
 */
const STATE_LABEL: Record<string, string> = {
  running: "ASAP is working on it",
  waiting_approval: "Waiting for your approval",
  waiting_party: "Waiting on an outside party",
  exception: "Stopped — needs a person",
  done: "Handed over",
  cancelled: "Cancelled",
};

type RunDb = {
  id: string; workflow: "renewal"; subject_id: string; work_item_id: string | null; state: string; current_step: string | null;
  exception: { code: string; message: string; needs: string; stepLabel?: string } | null; next_run_at: string; started_at: string; finished_at: string | null;
  facts: { clientId?: string; periodEnd?: string };
};

async function summaries(db: SupabaseClient, runs: RunDb[]) {
  const ids = runs.map((r) => r.id);
  const [steps, works, clients] = await Promise.all([
    ids.length ? db.from("workflow_steps").select("run_id, state").in("run_id", ids) : Promise.resolve({ data: [] }),
    runs.some((r) => r.work_item_id) ? db.from("work_items").select("id, title").in("id", runs.map((r) => r.work_item_id).filter(Boolean) as string[]) : Promise.resolve({ data: [] }),
    runs.some((r) => r.facts?.clientId) ? db.from("clients").select("id, name").in("id", runs.map((r) => r.facts?.clientId).filter(Boolean) as string[]) : Promise.resolve({ data: [] }),
  ]);
  const st = (steps.data ?? []) as { run_id: string; state: string }[];
  const titles = new Map(((works.data ?? []) as { id: string; title: string }[]).map((w) => [w.id, w.title]));
  const names = new Map(((clients.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  return runs.map((r) => {
    const mine = st.filter((s) => s.run_id === r.id);
    const clientId = r.facts?.clientId ?? null;
    return {
      id: r.id, workflow: r.workflow, subjectId: r.subject_id, workItemId: r.work_item_id, state: r.state as WorkflowDetail["state"], stateLabel: STATE_LABEL[r.state] ?? r.state,
      currentStep: r.current_step, exception: r.exception, nextRunAt: r.next_run_at, startedAt: r.started_at, finishedAt: r.finished_at,
      title: (r.work_item_id && titles.get(r.work_item_id)) || "Renewal",
      client: clientId && names.has(clientId) ? { id: clientId, name: names.get(clientId)! } : null,
      periodEnd: r.facts?.periodEnd ?? null,
      progress: { done: mine.filter((s) => s.state === "done" || s.state === "skipped").length, total: mine.length },
    };
  });
}

export async function loadWorkflowDetail(db: SupabaseClient, runId: string, perms: { canApprove: boolean; canAct: boolean }): Promise<WorkflowDetail | null> {
  const r = await db.from("workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (!r.data) return null;
  const run = r.data as RunDb;
  const [summary] = await summaries(db, [run]);
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
    return c.json(workflowListSchema.parse({ runs: await summaries(db, (data ?? []) as RunDb[]) }));
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
    const started = await detectRenewalFor(service, deps.logger, org.id, input.policyPeriodId);
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
    if ((r.data as { state: string }).state !== "exception") return respond(c, db, runId, ctx, "already", "The run is not stopped.");
    const service = deps.service();
    const now = new Date().toISOString();
    await service.from("workflow_steps").update({ state: "pending", attempts: 0, error: null, next_attempt_at: null, updated_at: now }).eq("run_id", runId).eq("state", "failed");
    await service.from("workflow_runs").update({ state: "running", exception: null, next_run_at: now, updated_at: now }).eq("id", runId).eq("state", "exception");
    await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: "workflow.resumed", objectType: "workflow_run", objectId: runId, result: "success" });
    await advance(runId);
    return respond(c, db, runId, ctx, "done", null);
  });

  return app;
}
