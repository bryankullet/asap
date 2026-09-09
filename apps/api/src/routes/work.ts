import {
  DRAFT_COLUMNS,
  DraftRow,
  RUN_COLUMNS,
  RunEventRow,
  RunRow,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  actRequestSchema,
  actResponseSchema,
  createPlacementRequestSchema,
  createWorkItemRequestSchema,
  createWorkItemResponseSchema,
  deriveTask,
  matchClientName,
  type ClientCandidate,
  type CreateWorkItemResponse,
  placementSteps,
  markDraftCopiedResponseSchema,
  renewalSteps,
  runEventsResponseSchema,
  workItemResponseSchema,
  type ActResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Logger } from "pino";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { applyAction } from "../engine/apply.js";
import { loadGuardFacts } from "../facts.js";
import { recordAudit } from "../audit.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import type { Executor } from "../runs/executor.js";
import { parseBody } from "./_parse.js";

export type WorkDeps = {
  logger: Logger;
  executor: (db: SupabaseClient) => Executor;
  bootToken: string;
  /** How long the SSE stream polls for new events between checks. */
  streamPollMs: number;
};

async function loadItem(db: SupabaseClient, id: string): Promise<WorkItemRow> {
  const { data, error } = await db
    .from("work_items")
    .select(WORK_ITEM_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw new HttpError(404, "not_found");
  return WorkItemRow.parse(data);
}

async function loadRun(db: SupabaseClient, id: string): Promise<RunRow> {
  const { data, error } = await db.from("runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw new HttpError(404, "not_found");
  return RunRow.parse(data);
}

async function loadEvents(db: SupabaseClient, runId: string, afterSeq: number) {
  const { data, error } = await db
    .from("run_events")
    .select("id, run_id, seq, kind, message, created_at")
    .eq("run_id", runId)
    .gt("seq", afterSeq)
    .order("seq", { ascending: true });
  if (error) throw mapDatabaseError(error);
  return RunEventRow.array().parse(data ?? []);
}

/** The engine's HTTP surface (UI Build Spec v1 Parts 5, 7, 8). Writes go through 0023's functions only. */
export function workRoutes(deps: WorkDeps) {
  const app = new Hono();

  /**
   * Create a renewal. The client is matched by normalised name (one match proceeds, several ask
   * which, none offers creation through the H05 path) or given by id. Asking twice reopens the
   * same item (Part 5.4 invariant 1). Ask never creates a client (D-050).
   */
  app.post("/work-items", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createWorkItemRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    let client: { id: string; name: string };
    if (input.clientId) {
      const r = await db
        .from("clients")
        .select("id, name, kind")
        .eq("id", input.clientId)
        .is("deleted_at", null)
        .maybeSingle();
      if (r.error) return sendError(c, mapDatabaseError(r.error));
      if (!r.data) return sendError(c, new HttpError(404, "not_found"));
      client = r.data as { id: string; name: string };
    } else {
      const r = await db
        .from("clients")
        .select("id, name, kind")
        .eq("organization_id", org.id)
        .is("deleted_at", null);
      if (r.error) return sendError(c, mapDatabaseError(r.error));
      const match = matchClientName(input.clientName!, (r.data ?? []) as ClientCandidate[]);
      if (match.outcome === "many") {
        return c.json(
          createWorkItemResponseSchema.parse({
            outcome: "ambiguous",
            name: input.clientName,
            candidates: match.candidates,
          }),
          409,
        );
      }
      if (match.outcome === "none") {
        const body: CreateWorkItemResponse = {
          outcome: "no_client",
          name: input.clientName!,
          intent: {
            type: "answer",
            target: null,
            panel: null,
            view: "summary",
            answer: `No client called "${input.clientName}" is on file in ${org.name}.`,
            suggestions: [`Create ${input.clientName} as a new client`],
          },
        };
        return c.json(createWorkItemResponseSchema.parse(body), 404);
      }
      client = match.client;
    }

    const steps = renewalSteps({ clientName: client.name, insurers: input.insurers });
    const task = deriveTask(steps);
    const { data, error } = await db.rpc("work_item_create", {
      p_organization_id: org.id,
      p_kind: input.kind,
      p_title: `${client.name} — renewal`,
      p_client_name: client.name,
      p_steps: steps,
      p_task_status: task.status,
      p_task_party: task.party,
      p_client_id: client.id,
      p_insurer_id: null,
      p_class_of_business: null,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    const { id, reopened } = data as { id: string; reopened: boolean };
    const item = await loadItem(db, id);
    return c.json(
      createWorkItemResponseSchema.parse({ outcome: "opened", item, reopened }),
      reopened ? 200 : 201,
    );
  });

  /** A placement (Part 6.2). The gate is evaluated at approval, not here. */
  app.post("/placements", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createPlacementRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const [clientR, insurerR] = await Promise.all([
      db
        .from("clients")
        .select("id, name")
        .eq("id", input.clientId)
        .is("deleted_at", null)
        .maybeSingle(),
      db
        .from("insurers")
        .select("id, name")
        .eq("id", input.insurerId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    if (clientR.error) return sendError(c, mapDatabaseError(clientR.error));
    if (insurerR.error) return sendError(c, mapDatabaseError(insurerR.error));
    if (!clientR.data || !insurerR.data) return sendError(c, new HttpError(404, "not_found"));
    const client = clientR.data as { id: string; name: string };
    const insurer = insurerR.data as { id: string; name: string };
    const steps = placementSteps({
      clientName: client.name,
      insurer: insurer.name,
      classOfBusiness: input.classOfBusiness,
    });
    const task = deriveTask(steps);
    const { data, error } = await db.rpc("work_item_create", {
      p_organization_id: org.id,
      p_kind: "placement",
      p_title: `${client.name} — ${input.classOfBusiness} placement with ${insurer.name}`,
      p_client_name: client.name,
      p_steps: steps,
      p_task_status: task.status,
      p_task_party: task.party,
      p_client_id: client.id,
      p_insurer_id: insurer.id,
      p_class_of_business: input.classOfBusiness,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    const { id, reopened } = data as { id: string; reopened: boolean };
    const item = await loadItem(db, id);
    return c.json(
      createWorkItemResponseSchema.parse({ outcome: "opened", item, reopened }),
      reopened ? 200 : 201,
    );
  });

  app.get("/work-items/:id", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const item = await loadItem(db, id);
    const [runsR, draftsR] = await Promise.all([
      db
        .from("runs")
        .select(RUN_COLUMNS)
        .eq("work_item_id", id)
        .order("started_at", { ascending: false }),
      db
        .from("drafts")
        .select(DRAFT_COLUMNS)
        .eq("work_item_id", id)
        .order("created_at", { ascending: true }),
    ]);
    if (runsR.error) return sendError(c, mapDatabaseError(runsR.error));
    if (draftsR.error) return sendError(c, mapDatabaseError(draftsR.error));
    return c.json(
      workItemResponseSchema.parse({
        item,
        runs: RunRow.array().parse(runsR.data ?? []),
        drafts: DraftRow.array().parse(draftsR.data ?? []),
      }),
    );
  });

  /** One verb on one step. Guards are evaluated here and re-checked by the database at execution. */
  app.post("/work-items/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const req = await parseBody(c, actRequestSchema);
    const item = await loadItem(db, id);
    const facts = await loadGuardFacts(db, item);
    const ctx = await resolveContext(db, user.id);
    const result = applyAction(
      item,
      req,
      { userId: user.id, now: new Date(), roleKey: ctx.activeMembership?.role.key ?? null },
      facts,
    );
    if (result.kind === "blocked") {
      // A guard that refuses is a denied action: audited under the caller's session (D-026).
      await recordAudit(db, deps.logger, c, {
        organizationId: item.organization_id,
        actorUserId: user.id,
        action: `work_item.${req.verb}`,
        objectType: "work_item",
        objectId: item.id,
        newState: { step_id: req.stepId, guard: result.guard },
        result: "denied",
        failureReason: result.guard,
      });
      const body: ActResponse = {
        outcome: "blocked",
        item,
        guard: result.guard,
        reason: result.reason,
      };
      return c.json(actResponseSchema.parse(body), 409);
    }
    const { derived, effects } = result;

    if (effects.startRun) {
      const { data, error } = await db.rpc("run_start", {
        p_work_item_id: id,
        p_expected_version: req.version,
        p_title: effects.startRun.title,
        p_steps: derived.steps,
        p_boot_token: deps.bootToken,
      });
      if (error) return sendError(c, engineError(error));
      const run = await loadRun(db, data as string);
      const fresh = await loadItem(db, id);
      // Fire and forget: the stream carries progress; run_end writes the outcome atomically.
      void deps.executor(db)(run, fresh, effects.startRun.stepId, {
        clientFileState: facts.clientFileState,
        agreedRate: facts.agreedRate,
      });
      return c.json(actResponseSchema.parse({ outcome: "applied", item: fresh, run, draft: null }));
    }

    if (effects.createDraft) {
      const { data, error } = await db.rpc("draft_create", {
        p_work_item_id: id,
        p_step_id: effects.createDraft.stepId,
        p_to: effects.createDraft.to,
        p_subject: effects.createDraft.subject,
        p_body: effects.createDraft.body,
      });
      if (error) return sendError(c, mapDatabaseError(error));
      const { data: d, error: e2 } = await db
        .from("drafts")
        .select(DRAFT_COLUMNS)
        .eq("id", data as string)
        .maybeSingle();
      if (e2) return sendError(c, mapDatabaseError(e2));
      const draft = DraftRow.parse(d);
      return c.json(actResponseSchema.parse({ outcome: "applied", item, run: null, draft }));
    }

    if (effects.approve || effects.approveWithOverride) {
      // X01: the database re-checks the gate at execution and, on override, audits and creates the principal's item.
      const { error } = await db.rpc("work_item_approve", {
        p_id: id,
        p_expected_version: req.version,
        p_steps: derived.steps,
        p_task_status: derived.task.status,
        p_task_party: derived.task.party,
        p_task_since: derived.task.since,
        p_task_next_check: derived.task.nextCheck,
        p_override_reason: effects.approveWithOverride?.reason ?? null,
      });
      if (error) {
        const mapped = engineError(error);
        if (mapped.code === "client_file_not_cleared" || mapped.code === "principal_officer_only") {
          await recordAudit(db, deps.logger, c, {
            organizationId: item.organization_id,
            actorUserId: user.id,
            action: "placement.approve",
            objectType: "work_item",
            objectId: item.id,
            result: "denied",
            failureReason: mapped.code,
          });
          const current = await loadItem(db, id);
          return c.json(
            actResponseSchema.parse({
              outcome: "blocked",
              item: current,
              guard: "client_file_cleared",
              reason:
                mapped.code === "principal_officer_only"
                  ? "Only the principal officer can override the client-file gate."
                  : `${"We cannot instruct cover for a client whose file is not complete."}`,
            }),
            409,
          );
        }
        return sendError(c, mapped);
      }
      const fresh = await loadItem(db, id);
      return c.json(
        actResponseSchema.parse({ outcome: "applied", item: fresh, run: null, draft: null }),
      );
    }

    if (effects.recordSend) {
      const { error } = await db.rpc("draft_record_send", {
        p_id: effects.recordSend.draftId,
        p_evidence: effects.recordSend.evidence,
        p_outcome_unknown: effects.recordSend.outcomeUnknown,
      });
      if (error) return sendError(c, mapDatabaseError(error));
    }

    const { error } = await db.rpc("work_item_apply", {
      p_id: id,
      p_expected_version: req.version,
      p_steps: derived.steps,
      p_task_status: derived.task.status,
      p_task_party: derived.task.party,
      p_task_since: derived.task.since,
      p_task_next_check: derived.task.nextCheck,
      p_cover_status: derived.cover,
      p_money_status: derived.money,
      p_exception: derived.exception,
      p_completed_at: derived.completedAt,
      p_audit_action: result.auditAction,
      p_audit_new_state: {
        verb: req.verb,
        step_id: req.stepId,
        task_status: derived.task.status,
        evidence: req.evidence ?? null,
      },
    });
    if (error) {
      const mapped = engineError(error);
      if (mapped.code === "version_stale") {
        const current = await loadItem(db, id);
        return c.json(
          actResponseSchema.parse({
            outcome: "blocked",
            item: current,
            guard: "version_current",
            reason: "This item changed since you looked at it. Reload to see the current version.",
          }),
          409,
        );
      }
      return sendError(c, mapped);
    }
    const fresh = await loadItem(db, id);
    return c.json(
      actResponseSchema.parse({ outcome: "applied", item: fresh, run: null, draft: null }),
    );
  });

  /** Copying is a fact about the draft. It advances nothing (Part 7). */
  app.post("/drafts/:id/copied", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const { error } = await db.rpc("draft_mark_copied", { p_id: id });
    if (error) return sendError(c, mapDatabaseError(error));
    const { data, error: e2 } = await db
      .from("drafts")
      .select(DRAFT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (e2) return sendError(c, mapDatabaseError(e2));
    if (!data) return sendError(c, new HttpError(404, "not_found"));
    return c.json(markDraftCopiedResponseSchema.parse({ draft: DraftRow.parse(data) }));
  });

  app.get("/runs/:id/events", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const run = await loadRun(db, id);
    const events = await loadEvents(db, id, 0);
    return c.json(runEventsResponseSchema.parse({ run, events }));
  });

  /** SSE (Part 8): `step`, `paused`, `finished`, `error`. Replays persisted events, then follows. */
  app.get("/runs/:id/stream", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const first = await loadRun(db, id);
    return streamSSE(c, async (stream) => {
      let seq = 0;
      let run = first;
      for (;;) {
        const events = await loadEvents(db, id, seq);
        for (const e of events) {
          seq = e.seq;
          await stream.writeSSE({
            event: e.kind,
            id: String(e.seq),
            data: JSON.stringify({ message: e.message, at: e.created_at, status: run.status }),
          });
        }
        if (run.status !== "working") {
          await stream.writeSSE({
            event: "done",
            id: "end",
            data: JSON.stringify({ status: run.status, next_step: run.next_step }),
          });
          return;
        }
        await stream.sleep(deps.streamPollMs);
        run = await loadRun(db, id);
      }
    });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}

function engineError(err: { code?: string; message?: string }): HttpError {
  if (err.code === "40001") return new HttpError(409, "version_stale");
  return mapDatabaseError(err);
}
