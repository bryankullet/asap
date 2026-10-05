import {
  createPolicyRequestSchema,
  createPolicyResponseSchema,
  RUN_GROUP_LABELS,
  runNeedsPerson,
  RUN_LIST_FILTER_LABELS,
  RunGroup,
  RunListFilter,
  runListQuerySchema,
  runListResponseSchema,
  type RunListResponse,
  pinsResponseSchema,
  setPinRequestSchema,
  setPinResponseSchema,
  historyResponseSchema,
  searchResponseSchema,
  type SearchResult,
  WORK_KIND_LABELS,
  runDetailResponseSchema,
  type RunDetailResponse,
  type HistoryEntry,
  type HistoryResponse,
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
  claimActionSchema,
  claimSteps,
  classifyEndorsementRequest,
  deriveTask,
  endorsementSteps,
  policyResponseSchema,
  endorsementActionSchema,
  matchClientName,
  type ClientCandidate,
  type CreateWorkItemResponse,
  placementSteps,
  markDraftCopiedResponseSchema,
  renewalSteps,
  runEventsResponseSchema,
  workItemResponseSchema,
  manageWorkRequestSchema,
  draftProblems,
  manageWorkResponseSchema,
  type ActResponse,
  type ManageWorkResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Logger } from "pino";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { applyAction } from "../engine/apply.js";
import { loadGuardFacts } from "../facts.js";
import {
  clientPolicies,
  loadClaimDetail,
  loadEndorsementDetail,
  loadPolicy,
  today,
} from "../servicing.js";
import { emitEvent } from "../events/emit.js";
import { recordAudit } from "../audit.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import type { Executor, RunFacts } from "../runs/executor.js";
import { parseBody } from "./_parse.js";
import { renewalTitle } from "../policy/space.js";
import { loadRecordContext } from "../attention/record-context.js";

export type WorkDeps = {
  logger: Logger;
  executor: (db: SupabaseClient) => Executor;
  bootToken: string;
  /** How long the SSE stream polls for new events between checks. */
  streamPollMs: number;
};

/** `claim.changed` / `endorsement.changed` (D-143), about the claim or endorsement behind a Work item. */
async function emitChanged(db: SupabaseClient, logger: Logger, kind: string, workItemId: string, userId: string) {
  if (kind !== "claim" && kind !== "endorsement") return;
  const table = kind === "claim" ? "claims" : "endorsements";
  const r = await db.from(table).select("id, organization_id").eq("work_item_id", workItemId).maybeSingle();
  const row = r.data as { id: string; organization_id: string } | null;
  if (!row) return;
  await emitEvent(db, logger, { organizationId: row.organization_id, eventType: `${kind}.changed`, entityType: kind, entityId: row.id, actor: "user", actorUserId: userId, payload: { [`${kind}Id`]: row.id, workItemId } });
}

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
    // Reporting a claim is claim work; a renewal or endorsement is policy work. Read-only may do neither.
    const [permObject, permVerb] = input.kind === "claim" ? ["claim", "create"] : ["policy", "edit"];
    if (!hasPermission(ctx, permObject, permVerb)) {
      await recordAudit(db, deps.logger, c, { organizationId: org.id, actorUserId: user.id, action: `work_item.create_${input.kind}`, objectType: "work_item", objectId: null, result: "denied", failureReason: "permission_denied" });
      throw new HttpError(403, "not_permitted", "Your role cannot start this work. Nothing was written.");
    }

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

    // Endorsements need a policy: the given one, the client's only one, or ask which.
    let policy: {
      id: string;
      insurerId: string;
      insurerName: string;
      className: string;
      number: string | null;
    } | null = null;
    if (input.kind === "endorsement") {
      const policies = await clientPolicies(db, client.id);
      const chosen = input.policyId
        ? policies.find((p) => p.policy.id === input.policyId)
        : policies.length === 1
          ? policies[0]
          : undefined;
      if (!chosen) {
        if (policies.length === 0) {
          return c.json(
            createWorkItemResponseSchema.parse({
              outcome: "no_policy",
              clientId: client.id,
              intent: {
                type: "answer",
                target: null,
                panel: null,
                view: "summary",
                answer: `${client.name} has no policy on file to change.`,
                suggestions: [],
              },
            }),
            404,
          );
        }
        return c.json(
          createWorkItemResponseSchema.parse({
            outcome: "ambiguous_policy",
            clientId: client.id,
            candidates: policies.map((p) => ({
              id: p.policy.id,
              label: `${p.policy.class_of_business} with ${p.insurerName}${p.policy.policy_number ? ` (${p.policy.policy_number})` : ""}`,
            })),
          }),
          409,
        );
      }
      policy = {
        id: chosen.policy.id,
        insurerId: chosen.policy.insurer_id,
        insurerName: chosen.insurerName,
        className: chosen.policy.class_of_business,
        number: chosen.policy.policy_number,
      };
    }

    /*
     * A claim or a renewal started from a policy names that policy — one of this client's, read
     * under the caller's session. A policy id that is not the client's is refused, never borrowed.
     */
    let named: Awaited<ReturnType<typeof clientPolicies>>[number] | null = null;
    if (input.policyId && input.kind !== "endorsement") {
      named = (await clientPolicies(db, client.id)).find((p) => p.policy.id === input.policyId) ?? null;
      if (!named) return sendError(c, new HttpError(404, "not_found", "That policy is not this client's."));
    }

    let steps;
    let title: string;
    if (input.kind === "claim") {
      const policies = await clientPolicies(db, client.id);
      steps = claimSteps({
        clientName: client.name,
        insurerName: named ? named.insurerName : policies.length === 1 ? policies[0]!.insurerName : null,
      });
      /*
       * A claim's identity is its title. Started from a policy, the policy is part of it: two
       * policies' claims on the same day are two claims, and a repeated click is still one.
       */
      title = named
        ? `${client.name} — claim, ${named.policy.class_of_business}${named.policy.policy_number ? ` ${named.policy.policy_number}` : ""}, incident ${input.incidentOn}`
        : `${client.name} — claim, incident ${input.incidentOn}`;
    } else if (input.kind === "endorsement") {
      steps = endorsementSteps({ insurerName: policy!.insurerName });
      title = `${client.name} — policy change, ${policy!.className}${policy!.number ? ` ${policy!.number}` : ""}`;
    } else {
      steps = renewalSteps({ clientName: client.name, insurers: input.insurers });
      /* Keyed by the policy when started from one, so starting it twice opens the same renewal. */
      title = named ? renewalTitle(client.name, named.policy.class_of_business, named.policy.policy_number) : `${client.name} — renewal`;
    }
    const task = deriveTask(steps);
    const { data, error } = await db.rpc("work_item_create", {
      p_organization_id: org.id,
      p_kind: input.kind,
      p_title: title,
      p_client_name: client.name,
      p_steps: steps,
      p_task_status: task.status,
      p_task_party: task.party,
      p_client_id: client.id,
      p_insurer_id: policy?.insurerId ?? named?.policy.insurer_id ?? null,
      p_class_of_business: policy?.className ?? named?.policy.class_of_business ?? null,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    const { id, reopened } = data as { id: string; reopened: boolean };

    // The record behind the item, created once: a claim is always a draft; an endorsement records who asked.
    if (!reopened && input.kind === "claim") {
      const r = await db.rpc("claim_create", {
        p_work_item_id: id,
        p_client_id: client.id,
        p_policy_id: named?.policy.id ?? null,
        p_incident_on: input.incidentOn,
        p_summary: input.incidentSummary,
        p_source: input.source ?? "ask",
      });
      if (r.error) return sendError(c, mapDatabaseError(r.error));
      // A claim was reported (D-140): the claim run starts. Once per claim.
      const claimRow = await db.from("claims").select("id").eq("work_item_id", id).maybeSingle();
      const claimId = (claimRow.data as { id: string } | null)?.id;
      if (claimId)
        await emitEvent(db, deps.logger, { organizationId: org.id, eventType: "claim.reported", entityType: "claim", entityId: claimId, actor: "user", actorUserId: user.id, payload: { claimId, workItemId: id, clientId: client.id }, dedupeKey: claimId });
      /*
       * A new claim is looked at again in two days: the documents an insurer assesses are what a
       * late claim is refused for. Written through the same contract as every derived work state.
       */
      const created = await loadItem(db, id);
      const now = created.steps.find((s) => s.state === "now" || s.state === "blocked") ?? null;
      const check = new Date(Date.now() + 2 * 86_400_000).toISOString();
      await db.rpc("work_item_set_state", {
        p_work_item_id: id,
        p_task_status: created.task_status,
        p_task_party: created.task_party,
        p_task_since: created.task_since,
        p_task_next_check: check,
        p_reason: created.reason ?? "A claim is only as strong as the documents behind it and how soon the insurer hears of it.",
        p_required_action: now?.label ?? "Collect the claim documents",
        p_evidence_needed: now ? now.evidence.filter((e) => !now.recorded.some((x) => x.kind === e.kind)).map((e) => e.label).join("; ") || null : null,
      });
    }
    if (!reopened && input.kind === "endorsement") {
      const r = await db.rpc("endorsement_create", {
        p_work_item_id: id,
        p_policy_id: policy!.id,
        p_kind: classifyEndorsementRequest(input.requestText!),
        p_requested_by: input.requestedBy ?? "policyholder",
        p_requested_by_name:
          input.requestedByName ?? (input.requestedBy === "other" ? null : client.name),
        p_request_text: input.requestText,
        p_effective_on: input.effectiveOn ?? null,
        p_items: [],
      });
      if (r.error) return sendError(c, mapDatabaseError(r.error));
      // An endorsement was asked for (D-140): the endorsement run starts. Once per endorsement.
      const endRow = await db.from("endorsements").select("id").eq("work_item_id", id).maybeSingle();
      const endorsementId = (endRow.data as { id: string } | null)?.id;
      if (endorsementId)
        await emitEvent(db, deps.logger, { organizationId: org.id, eventType: "endorsement.requested", entityType: "endorsement", entityId: endorsementId, actor: "user", actorUserId: user.id, payload: { endorsementId, workItemId: id, clientId: client.id, policyId: policy!.id }, dedupeKey: endorsementId });
    }
    const item = await loadItem(db, id);
    return c.json(
      createWorkItemResponseSchema.parse({ outcome: "opened", item, reopened }),
      reopened ? 200 : 201,
    );
  });

  /** A policy, titled as itself: its periods and every version, old ones kept. */
  /**
   * Record cover the brokerage already places (D-068).
   *
   * Everything that decides whether this is allowed is server-side and in the database function:
   * the client decides the brokerage, membership is re-checked there, and the write is the one
   * SECURITY DEFINER wrapper — as every other write in the engine is. The insurer arrives by name
   * and is created if the brokerage has not named it before.
   */
  app.post("/policies", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createPolicyRequestSchema);

    /*
     * Which client, decided exactly as starting work decides it: one match proceeds, several is a
     * question, none is an answer — never a client conjured to satisfy the form (D-050).
     */
    let clientId = input.clientId;
    if (!clientId) {
      const ctx = await resolveContext(db, user.id);
      const org = requireActiveOrganization(ctx);
      const r = await db
        .from("clients")
        .select("id, name, kind")
        .eq("organization_id", org.id)
        .is("deleted_at", null);
      if (r.error) return sendError(c, mapDatabaseError(r.error));
      const match = matchClientName(input.clientName!, (r.data ?? []) as ClientCandidate[]);
      if (match.outcome === "many") {
        return c.json(
          createPolicyResponseSchema.parse({
            outcome: "ambiguous",
            name: input.clientName,
            candidates: match.candidates,
          }),
          409,
        );
      }
      if (match.outcome === "none") {
        return c.json(
          createPolicyResponseSchema.parse({ outcome: "no_client", name: input.clientName }),
          409,
        );
      }
      clientId = match.client.id;
    }

    const { data, error } = await db.rpc("policy_create", {
      p_client_id: clientId,
      p_insurer_name: input.insurerName,
      p_class_of_business: input.classOfBusiness,
      p_policy_number: input.policyNumber ?? null,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
    });
    if (error) return sendError(c, mapDatabaseError(error));
    const written = data as { policy_id: string; created: boolean };
    const policy = await loadPolicy(db, written.policy_id);
    if (!policy) return sendError(c, new HttpError(404, "not_found"));
    return c.json(
      createPolicyResponseSchema.parse({
        outcome: "recorded",
        created: written.created,
        policy,
      }),
      written.created ? 201 : 200,
    );
  });

  app.get("/policies/:id", async (c) => {
    const { db } = c.get("auth");
    const policy = await loadPolicy(db, c.req.param("id"));
    if (!policy) return sendError(c, new HttpError(404, "not_found"));
    return c.json(policyResponseSchema.parse(policy));
  });

  /** Facts a person records about the claim itself, outside the step verbs. */
  app.post("/claims/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, claimActionSchema);
    let r: { error: { code?: string; message?: string } | null };
    switch (input.action) {
      case "set_clock":
        r = await db.rpc("claim_set_clock", {
          p_claim_id: id,
          p_clause: input.clauseReference,
          p_page: input.clausePage,
          p_days: input.clauseDays,
          p_start_event: input.startEvent,
          p_start_on: input.startOn,
          p_start_evidence: input.startEvidence,
        });
        break;
      case "add_document":
        r = await db.rpc("claim_document_add", {
          p_claim_id: id,
          p_label: input.label,
          p_holder: input.holder,
        });
        break;
      case "receive_document":
        r = await db.rpc("claim_document_receive", {
          p_document_id: input.documentId,
          p_reference: input.reference,
        });
        break;
      case "add_call_note":
        r = await db.rpc("claim_note_add", {
          p_claim_id: id,
          p_kind: "call_note",
          p_spoke_with: input.spokeWith,
          p_body: input.body,
        });
        break;
      case "set_insurer_reference":
        r = await db.rpc("claim_set_insurer_reference", {
          p_claim_id: id,
          p_reference: input.reference,
        });
        break;
    }
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    // The insurer has registered the claim (D-140): its reference is the evidence. Once per claim.
    if (input.action === "set_insurer_reference") {
      const cl = await db.from("claims").select("organization_id, work_item_id").eq("id", id).maybeSingle();
      const row = cl.data as { organization_id: string; work_item_id: string } | null;
      if (row)
        await emitEvent(db, deps.logger, { organizationId: row.organization_id, eventType: "claim.registered", entityType: "claim", entityId: id, actor: "user", actorUserId: user.id, payload: { claimId: id, workItemId: row.work_item_id }, dedupeKey: id });
    }
    const wiR = await db.from("claims").select("work_item_id").eq("id", id).maybeSingle();
    if (wiR.error) return sendError(c, mapDatabaseError(wiR.error));
    if (wiR.data) await emitChanged(db, deps.logger, "claim", (wiR.data as { work_item_id: string }).work_item_id, user.id);
    const detail = wiR.data
      ? await loadClaimDetail(db, (wiR.data as { work_item_id: string }).work_item_id)
      : null;
    return c.json({ claim: detail });
  });

  app.post("/endorsements/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, endorsementActionSchema);
    let r: { error: { code?: string; message?: string } | null };
    switch (input.action) {
      case "classify":
        r = await db.rpc("endorsement_update", {
          p_id: id,
          p_kind: input.kind,
          p_effective_on: null,
          p_items: null,
        });
        break;
      case "set_details":
        r = await db.rpc("endorsement_update", {
          p_id: id,
          p_kind: null,
          p_effective_on: input.effectiveOn ?? null,
          p_items: input.items
            ? input.items.map((i) => ({ ...i, decision: "pending", note: null }))
            : null,
        });
        break;
      case "record_instruction":
        r = await db.rpc("endorsement_record_instruction", {
          p_id: id,
          p_reference: input.reference,
          p_from: input.from,
          p_from_name: input.fromName ?? null,
        });
        break;
      case "decide_item":
        r = await db.rpc("endorsement_item_decide", {
          p_id: id,
          p_item_id: input.itemId,
          p_decision: input.decision,
          p_note: input.note ?? null,
          p_response_reference: input.responseReference,
        });
        break;
    }
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    const wiR = await db.from("endorsements").select("work_item_id").eq("id", id).maybeSingle();
    if (wiR.error) return sendError(c, mapDatabaseError(wiR.error));
    if (wiR.data) await emitChanged(db, deps.logger, "endorsement", (wiR.data as { work_item_id: string }).work_item_id, user.id);
    const detail = wiR.data
      ? await loadEndorsementDetail(db, (wiR.data as { work_item_id: string }).work_item_id)
      : null;
    return c.json({ endorsement: detail });
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
    const claim = item.kind === "claim" ? await loadClaimDetail(db, id) : null;
    const endorsement = item.kind === "endorsement" ? await loadEndorsementDetail(db, id) : null;
    return c.json(
      workItemResponseSchema.parse({
        item,
        claim,
        endorsement,
        runs: RunRow.array().parse(runsR.data ?? []),
        drafts: DraftRow.array().parse(draftsR.data ?? []),
      }),
    );
  });

  /**
   * The audit history of one record (C05: never rewrite historical outcomes).
   *
   * Read-only, under the caller's RLS, and gated on `audit:view` so a role without it is told so
   * by name rather than shown an empty list. Rows are summarised into the fields that changed;
   * `apps/api/src/audit.ts` already refuses to write document contents or credentials, so there
   * is nothing here to redact a second time.
   */
  /**
   * A person's own pins (0033). RLS already limits this to the caller's, and to this brokerage;
   * the filters below say so at the call site rather than relying on that alone.
   *
   * There is no Pinned navigation tab and this endpoint is not a Work view. It answers "what did I
   * keep?" for the marker on a record — nothing here ranks, filters or changes work.
   */
  app.get("/pins", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("work_item_pins")
      .select("work_item_id, note, created_at")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return sendError(c, mapDatabaseError(error));
    const rows = (data ?? []) as {
      work_item_id: string;
      note: string | null;
      created_at: string;
    }[];
    if (rows.length === 0) return c.json(pinsResponseSchema.parse({ pins: [] }));

    // Titles come from the record, read under the same session. A pin on something the caller can
    // no longer see simply does not appear — it is not an error and it names nothing.
    const { data: items, error: itemsErr } = await db
      .from("work_items")
      .select("id, title")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .in(
        "id",
        rows.map((r) => r.work_item_id),
      );
    if (itemsErr) return sendError(c, mapDatabaseError(itemsErr));
    const titles = new Map(
      ((items ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title]),
    );
    return c.json(
      pinsResponseSchema.parse({
        pins: rows
          .filter((r) => titles.has(r.work_item_id))
          .map((r) => ({
            workItemId: r.work_item_id,
            title: titles.get(r.work_item_id) ?? "",
            note: r.note,
            createdAt: r.created_at,
          })),
      }),
    );
  });

  /**
   * Pin or unpin a record for the caller. Pinning twice is the same pin — the primary key makes it
   * so, and the route upserts rather than counting. Nothing about the record changes: no step, no
   * guard, no version bump, and no audit row, because keeping a personal marker is not a business
   * action on the brokerage's record.
   */
  app.put("/work-items/:id/pin", async (c) => {
    const { db, user } = c.get("auth");
    const parsed = setPinRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "validation_failed", "pinned is required");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");

    // The record must be one the caller can read. Without this, an unreadable id would come back
    // as a successful pin and quietly confirm that it exists.
    const { data: item, error: itemErr } = await db
      .from("work_items")
      .select("id")
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (itemErr) return sendError(c, mapDatabaseError(itemErr));
    if (!item) throw new HttpError(404, "not_found", "That record is not available.");

    if (!parsed.data.pinned) {
      const { error } = await db
        .from("work_item_pins")
        .delete()
        .eq("work_item_id", id)
        .eq("user_id", user.id);
      if (error) return sendError(c, mapDatabaseError(error));
      return c.json(setPinResponseSchema.parse({ pinned: false }));
    }
    const { error } = await db
      .from("work_item_pins")
      .upsert(
        { organization_id: org.id, work_item_id: id, user_id: user.id, note: parsed.data.note },
        { onConflict: "work_item_id,user_id" },
      );
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(setPinResponseSchema.parse({ pinned: true }));
  });

  /**
   * The brokerage's own history — the same audit rows, not scoped to one record (§45 rule 15).
   *
   * Read-only, under the caller's RLS, and gated on `audit:view` so a role without it is told so
   * by name rather than shown an empty list. AI actions, automation runs and failures are in here
   * with everything else: a history that quietly omitted them would be worse than none.
   */
  /**
   * Search across the brokerage's own records (D-064).
   *
   * Three lookups under the caller's RLS — clients by name, policies by number, work by title —
   * run together and returned in the order a person scans them. No vector search: "what is policy
   * P-4471?" is a lookup (§45 rule 7). A table that cannot be read degrades that group rather than
   * failing the whole answer.
   */
  app.get("/search", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const q = (c.req.query("q") ?? "").trim().slice(0, 120);
    if (q === "") return c.json(searchResponseSchema.parse({ query: "", results: [] }));
    // Escape PostgREST's own pattern characters so a typed % is a literal, not a wildcard.
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;

    /*
     * Eight reads, one round trip. Every one is scoped to the organization *and* runs under the
     * caller's session, so RLS decides what exists before anything is matched: a row the caller
     * cannot see is not returned, not counted and not hinted at.
     *
     * A read that fails adds a line to `degraded` and contributes nothing, rather than failing the
     * whole search — a person typing a registration wants the four kinds that did answer.
     */
    const [clients, policies, items, claims, insurers, documents, threads, runs] = await Promise.all([
      db
        .from("clients")
        .select("id, name, kind, file_status")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .ilike("name", like)
        .limit(10),
      db
        .from("policies")
        .select("id, policy_number, class_of_business, client_id")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .ilike("policy_number", like)
        .limit(10),
      db
        .from("work_items")
        .select("id, title, kind, task_status, client_id")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .ilike("title", like)
        .limit(10),
      /*
       * A claim is found by its insurer reference or by what happened. `or` is one request rather
       * than two: a person searching "windscreen" and a person searching "CL-4471" are both
       * looking for the same claim.
       */
      db
        .from("claims")
        .select("id, incident_summary, insurer_reference, status, client_id, work_item_id")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .or(`incident_summary.ilike.${like},insurer_reference.ilike.${like}`)
        .limit(10),
      db
        .from("insurers")
        .select("id, name")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .ilike("name", like)
        .limit(10),
      db
        .from("documents")
        .select("id, filename, kind, client_id, extraction_state")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .ilike("filename", like)
        .limit(10),
      db
        .from("email_threads")
        .select("id, subject, client_id, last_message_at")
        .eq("organization_id", org.id)
        .ilike("subject", like)
        .limit(10),
      db
        .from("runs")
        .select("id, title, status, work_item_id")
        .eq("organization_id", org.id)
        .ilike("title", like)
        .limit(10),
    ]);

    const degraded: { what: string; because: string }[] = [];
    const results: SearchResult[] = [];

    /*
     * Client names, for the hits that carry a client id and nothing readable. A document called
     * "schedule.pdf" is meaningless on its own, and four of them are indistinguishable.
     */
    const named = new Map<string, string>();
    for (const r of (clients.data ?? []) as { id: string; name: string }[]) named.set(r.id, r.name);
    const clientIds = [
      ...new Set(
        [
          ...((policies.data ?? []) as { client_id: string | null }[]),
          ...((items.data ?? []) as { client_id: string | null }[]),
          ...((claims.data ?? []) as { client_id: string | null }[]),
          ...((documents.data ?? []) as { client_id: string | null }[]),
          ...((threads.data ?? []) as { client_id: string | null }[]),
        ]
          .map((r) => r.client_id)
          .filter((v): v is string => v !== null && !named.has(v)),
      ),
    ];
    if (clientIds.length > 0) {
      const extra = await db.from("clients").select("id, name").in("id", clientIds);
      if (extra.error) {
        degraded.push({ what: "Client names on some results", because: "They could not be read." });
      } else {
        for (const r of (extra.data ?? []) as { id: string; name: string }[]) named.set(r.id, r.name);
      }
    }
    const clientOf = (id: string | null) => (id === null ? null : (named.get(id) ?? null));

    if (clients.error) degraded.push({ what: "Clients", because: "They could not be read." });
    for (const r of (clients.data ?? []) as {
      id: string;
      name: string;
      kind: string;
      file_status: string;
    }[]) {
      results.push({
        id: r.id,
        kind: "client",
        title: r.name,
        subtitle: `${r.kind === "corporate" ? "Corporate" : "Individual"} client`,
        to: `/clients/${r.id}`,
        clientName: null,
      });
    }

    if (policies.error) degraded.push({ what: "Policies", because: "They could not be read." });
    for (const r of (policies.data ?? []) as {
      id: string;
      policy_number: string;
      class_of_business: string;
      client_id: string | null;
    }[]) {
      results.push({
        id: r.id,
        kind: "policy",
        title: r.policy_number,
        subtitle: r.class_of_business,
        to: `/policies/${r.id}`,
        clientName: clientOf(r.client_id),
      });
    }

    if (items.error) degraded.push({ what: "Work", because: "It could not be read." });
    for (const r of (items.data ?? []) as {
      id: string;
      title: string;
      kind: string;
      client_id: string | null;
    }[]) {
      results.push({
        id: r.id,
        kind: "work",
        title: r.title,
        subtitle: WORK_KIND_LABELS[r.kind as keyof typeof WORK_KIND_LABELS] ?? "Work",
        to: `/r/${r.id}`,
        clientName: clientOf(r.client_id),
      });
    }

    if (claims.error) degraded.push({ what: "Claims", because: "They could not be read." });
    for (const r of (claims.data ?? []) as {
      id: string;
      incident_summary: string;
      insurer_reference: string | null;
      status: string;
      client_id: string | null;
      work_item_id: string;
    }[]) {
      results.push({
        id: r.id,
        kind: "claim",
        title: r.insurer_reference ?? r.incident_summary,
        subtitle: r.insurer_reference === null ? "No insurer reference on file" : r.incident_summary,
        // A claim's Space is its work item's: that is where its steps and its evidence are.
        to: `/r/${r.work_item_id}`,
        clientName: clientOf(r.client_id),
      });
    }

    if (insurers.error) degraded.push({ what: "Insurers", because: "They could not be read." });
    for (const r of (insurers.data ?? []) as { id: string; name: string }[]) {
      results.push({
        id: r.id,
        kind: "insurer",
        title: r.name,
        subtitle: "Insurer",
        to: `/settings/agreements`,
        clientName: null,
      });
    }

    if (documents.error) degraded.push({ what: "Documents", because: "They could not be read." });
    for (const r of (documents.data ?? []) as {
      id: string;
      filename: string;
      kind: string;
      client_id: string | null;
      extraction_state: string;
    }[]) {
      results.push({
        id: r.id,
        kind: "document",
        title: r.filename,
        // Never "read" unless it was: an unread document described as read is the one claim this
        // product must not make.
        subtitle: r.extraction_state === "extracted" ? r.kind : `${r.kind} · not read yet`,
        to: `/documents/${r.id}`,
        clientName: clientOf(r.client_id),
      });
    }

    if (threads.error) degraded.push({ what: "Email", because: "It could not be read." });
    for (const r of (threads.data ?? []) as {
      id: string;
      subject: string;
      client_id: string | null;
    }[]) {
      results.push({
        id: r.id,
        kind: "email",
        title: r.subject,
        subtitle: "Email thread",
        to: `/email?thread=${r.id}`,
        clientName: clientOf(r.client_id),
      });
    }

    if (runs.error) degraded.push({ what: "Runs", because: "They could not be read." });
    for (const r of (runs.data ?? []) as {
      id: string;
      title: string;
      status: string;
      work_item_id: string | null;
    }[]) {
      results.push({
        id: r.id,
        kind: "run",
        title: r.title,
        subtitle: `Run · ${r.status}`,
        to: `/jobs?filter=all`,
        clientName: null,
      });
    }

    return c.json(searchResponseSchema.parse({ query: q, results, degraded }));
  });

  app.get("/audit", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "audit", "view")) {
      throw new HttpError(403, "forbidden", "Your role does not include the audit history");
    }
    const { data, error } = await db
      .from("audit_log")
      .select(
        "id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state, evidence, result, failure_reason, occurred_at",
      )
      .eq("organization_id", org.id)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(await summariseHistory(db, null, (data ?? []) as AuditRow[]));
  });

  app.get("/work-items/:id/history", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "audit", "view")) {
      throw new HttpError(403, "forbidden", "Your role does not include the audit history");
    }
    // The record must resolve for this caller first: history is not a way around RLS.
    const item = await loadItem(db, id);

    const { data, error } = await db
      .from("audit_log")
      .select(
        "id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state, evidence, result, failure_reason, occurred_at",
      )
      .eq("organization_id", org.id)
      .eq("object_id", item.id)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (error) return sendError(c, mapDatabaseError(error));

    return c.json(await summariseHistory(db, id, (data ?? []) as AuditRow[]));
  });

  /** One verb on one step. Guards are evaluated here and re-checked by the database at execution. */
  app.post("/work-items/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const req = await parseBody(c, actRequestSchema);
    const item = await loadItem(db, id);
    const facts = await loadGuardFacts(db, item);
    const ctx = await resolveContext(db, user.id);
    /*
     * A claim notice needs a connected mailbox and a verified insurer address; ASAP verifies no
     * insurer address yet, so a claim notice cannot be prepared at all (D-123). Refused before any
     * step logic, so no path around it exists.
     */
    if (item.kind === "claim" && req.verb === "draft") {
      const mailbox = await db.from("mailboxes").select("id").eq("organization_id", item.organization_id).eq("status", "connected").limit(1);
      const why = [...((mailbox.data ?? []).length === 0 ? ["no mailbox is connected"] : []), "no verified insurer address is on file"];
      await recordAudit(db, deps.logger, c, { organizationId: item.organization_id, actorUserId: user.id, action: "work_item.draft", objectType: "work_item", objectId: item.id, result: "denied", failureReason: "unsafe_draft" });
      return c.json(actResponseSchema.parse({ outcome: "blocked", item, guard: "evidence_present", reason: `A claim notice cannot be prepared: ${why.join("; ")}. Nothing was prepared or sent.` } satisfies ActResponse), 409);
    }
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

    /*
     * An unsafe message is refused here, not hidden in the browser (D-123). A claim notice needs a
     * connected mailbox and a verified insurer address, and no insurer address is verified in
     * ASAP yet, so a claim notice cannot be prepared at all. Any other draft is refused when it
     * carries a blank value or an invented address.
     */
    if (effects.createDraft) {
      const d = effects.createDraft;
      const refuse = async (reason: string) => {
        await recordAudit(db, deps.logger, c, {
          organizationId: item.organization_id,
          actorUserId: user.id,
          action: "work_item.draft",
          objectType: "work_item",
          objectId: item.id,
          result: "denied",
          failureReason: "unsafe_draft",
        });
        return c.json(actResponseSchema.parse({ outcome: "blocked", item, guard: "evidence_present", reason } satisfies ActResponse), 409);
      };
      const unsafe = draftProblems(d).filter((p) => /blank value|not a real address/.test(p));
      if (unsafe.length) return refuse(`This message cannot be prepared: ${unsafe.join("; ")}. Nothing was prepared or sent.`);
    }

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
      const runFacts: RunFacts = {
        clientFileState: facts.clientFileState,
        agreedRate: facts.agreedRate,
        today: today(),
      };
      if (facts.claim !== undefined) runFacts.claim = facts.claim;
      if (facts.endorsement !== undefined) runFacts.endorsement = facts.endorsement;
      if (facts.claim?.claim.policy_id) {
        const v = await db.rpc("policy_version_on", {
          p_policy_id: facts.claim.claim.policy_id,
          p_on: facts.claim.claim.incident_on,
        });
        if (v.error) return sendError(c, mapDatabaseError(v.error));
        const row = ((v.data ?? []) as { id: string; version: number }[])[0];
        const period = facts.claim.candidatePeriods.find(
          (p) => p.policy.id === facts.claim!.claim.policy_id,
        );
        runFacts.coverOnIncident =
          row && period
            ? {
                versionId: row.id,
                version: row.version,
                className: period.policy.class_of_business,
                insurerName: period.insurerName,
              }
            : null;
      }
      void deps.executor(db)(run, fresh, effects.startRun.stepId, runFacts);
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

    if (effects.registerClaim && facts.claim) {
      const { error } = await db.rpc("claim_register", {
        p_claim_id: facts.claim.claim.id,
        p_policy_period_id: effects.registerClaim.policyPeriodId,
      });
      if (error) return sendError(c, mapDatabaseError(error));
    }
    if (effects.claimFact && facts.claim) {
      const { error } = await db.rpc("claim_fact_record", {
        p_claim_id: facts.claim.claim.id,
        p_fact: effects.claimFact.fact,
        p_reference: effects.claimFact.reference,
      });
      if (error) return sendError(c, mapDatabaseError(error));
    }
    if (effects.applyEndorsement && facts.endorsement) {
      const { error } = await db.rpc("endorsement_apply", {
        p_id: facts.endorsement.endorsement.id,
      });
      if (error) {
        const mapped = mapDatabaseError(error);
        if (mapped.code === "policyholder_instruction_required") {
          const current = await loadItem(db, id);
          return c.json(
            actResponseSchema.parse({
              outcome: "blocked",
              item: current,
              guard: "evidence_present",
              reason:
                "Transfer of ownership needs the policyholder's own instruction. A request from anyone else is recorded, not acted on.",
            }),
            409,
          );
        }
        return sendError(c, mapped);
      }
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
      // The database function takes the inception date too (0026); without it no step could be applied.
      p_cover_inception_at: req.inceptionAt ?? null,
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
    // A person moved a claim or an endorsement on (D-143): its run looks again. Not deduplicated —
    // each step is its own fact, and a run that finds nothing new simply waits.
    await emitChanged(db, deps.logger, item.kind, id, user.id);
    const fresh = await loadItem(db, id);
    return c.json(
      actResponseSchema.parse({ outcome: "applied", item: fresh, run: null, draft: null }),
    );
  });

  /**
   * Who owns a Work item, when it is due, when it is looked at again (D-122). The one contract Ask
   * and the Work Space both call. `preview` reads and writes nothing; a confirmed change goes
   * through work_item_manage (0061), which re-checks permission, membership and version, and
   * audits. Asking for what is already true is `already_done`, so a double-click writes once.
   */
  app.post("/work-items/:id/manage", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const req = await parseBody(c, manageWorkRequestSchema);
    const item = await loadItem(db, id);
    const ctx = await resolveContext(db, user.id);
    const blocked = (status: 403 | 409 | 422, guard: string, reason: string, current = item) =>
      c.json(manageWorkResponseSchema.parse({ outcome: "blocked", item: current, guard, reason } satisfies ManageWorkResponse), status);

    const names = new Map<string, string>();
    const ids = [item.owner_id, req.ownerId].filter((v): v is string => typeof v === "string");
    if (ids.length) {
      const { data } = await db.from("users").select("id, display_name, full_name").in("id", ids);
      for (const u of (data ?? []) as { id: string; display_name: string | null; full_name: string | null }[])
        names.set(u.id, u.display_name ?? u.full_name ?? "A member");
    }
    const who = (v: string | null | undefined) => (v ? (names.get(v) ?? "someone outside this brokerage") : "Nobody");
    // A date as a broker reads it, in the brokerage's own time zone.
    const day = (v: string | null | undefined) =>
      v ? new Date(v.length === 10 ? v + "T12:00:00Z" : v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "No date";
    const changes: { field: "owner" | "due" | "next_check"; label: string; from: string | null; to: string | null }[] = [];
    if (req.ownerId !== undefined && req.ownerId !== item.owner_id)
      changes.push({ field: "owner", label: "Owner", from: who(item.owner_id), to: who(req.ownerId) });
    if (req.dueOn !== undefined && (req.dueOn ?? null) !== (item.due_on ?? null))
      changes.push({ field: "due", label: "Due", from: day(item.due_on), to: day(req.dueOn) });
    if (req.nextCheckAt !== undefined && (req.nextCheckAt ? new Date(req.nextCheckAt).getTime() : null) !== (item.task_next_check ? new Date(item.task_next_check).getTime() : null))
      changes.push({ field: "next_check", label: "Looked at again", from: day(item.task_next_check), to: day(req.nextCheckAt) });

    if (!hasPermission(ctx, "job", "edit")) {
      if (!req.preview)
        await recordAudit(db, deps.logger, c, { organizationId: item.organization_id, actorUserId: user.id, action: "work_item.manage", objectType: "work_item", objectId: item.id, result: "denied", failureReason: "permission_denied" });
      return blocked(403, "permission", "Your role can view Work but not change its owner or dates. Nothing was changed.");
    }
    if (item.task_status === "done") return blocked(409, "done", "This work is done; its owner and dates no longer change. Nothing was changed.");
    if (req.ownerId && !names.has(req.ownerId)) return blocked(422, "owner_not_member", "That person is not a member of this brokerage. Nothing was changed.");
    if (req.nextCheckAt && new Date(req.nextCheckAt).getTime() < Date.now() - 60_000)
      return blocked(422, "next_check_in_past", "The next check cannot be in the past. Nothing was changed.");

    if (!changes.length) return c.json(manageWorkResponseSchema.parse({ outcome: "already_done", item, changes }));
    if (req.preview)
      return c.json(manageWorkResponseSchema.parse({ outcome: "preview", item, changes, externalEffect: "No message is sent to anyone. The new owner sees it in their Work." }));

    const { data, error } = await db.rpc("work_item_manage", {
      p_work_item_id: id,
      p_expected_version: req.version,
      p_set_owner: req.ownerId !== undefined,
      p_owner_id: req.ownerId ?? null,
      p_set_due: req.dueOn !== undefined,
      p_due_on: req.dueOn ?? null,
      p_set_next_check: req.nextCheckAt !== undefined,
      p_next_check: req.nextCheckAt ?? null,
      p_note: req.note ?? null,
    });
    if (error) {
      const m = error.message ?? "";
      if (error.code === "40001" || m.includes("version_stale"))
        return blocked(409, "version_current", "This work changed since you looked at it. Nothing was changed; reload to see the current version.", await loadItem(db, id));
      if (m.includes("permission_denied")) return blocked(403, "permission", "Your role can view Work but not change it. Nothing was changed.");
      if (m.includes("owner_not_member")) return blocked(422, "owner_not_member", "That person is not a member of this brokerage. Nothing was changed.");
      return sendError(c, mapDatabaseError(error));
    }
    const fresh = await loadItem(db, id);
    const res = data as { changed: boolean };
    if (!res.changed) return c.json(manageWorkResponseSchema.parse({ outcome: "already_done", item: fresh, changes: [] }));
    const auditAction = changes.length === 1 && changes[0]!.field === "owner" ? "work_item.assigned" : changes.length === 1 && changes[0]!.field === "due" ? "work_item.due_changed" : "work_item.managed";
    return c.json(manageWorkResponseSchema.parse({ outcome: "applied", item: fresh, changes, auditAction }));
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

  /**
   * One run in full: what ASAP did, what it produced, what it is waiting for, and what a person
   * can safely do next. The Activity chip and a record's run history both open this.
   *
   * Recovery is deliberately narrow. `open_work` always exists, because a run that stopped has
   * already created or updated the item a person owns (Screen Map v3: "a run that pauses or fails
   * creates an item in Work first"). Retrying is offered only for a run that ended without doing
   * its job, and only as a disabled control with its reason when the step has moved on — a
   * person must never be able to re-run something whose record has changed underneath it.
   */
  /**
   * The Jobs board (D-064). What ASAP is processing, grouped by what each run is waiting on.
   *
   * Read under the caller's session, so RLS decides what exists before anything is grouped. The
   * organization comes from the session and is scoped again in the query (§45 rule 5). Progress is
   * derived from the steps of the work each run is advancing, never authored (rule 10), and is
   * null when there are no steps to derive it from — the card then shows no bar rather than
   * inventing a number.
   *
   * A finished job is an output, never a business outcome: whether cover was confirmed, a claim
   * accepted or money received is a different fact, on the record, with its own evidence.
   */
  app.get("/runs", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const q = runListQuerySchema.parse({
      filter: c.req.query("filter"),
      limit: c.req.query("limit"),
    });
    const now = new Date();
    const generatedAt = now.toISOString();

    const runsR = await db
      .from("runs")
      .select(RUN_COLUMNS)
      .eq("organization_id", org.id)
      .order("started_at", { ascending: false });
    if (runsR.error) return sendError(c, mapDatabaseError(runsR.error));
    const runs = RunRow.array().parse(runsR.data ?? []);

    /*
     * Five stored statuses, three words. `paused` is a run still open and waiting on an outside
     * party, which is Working: the party belongs to the human-work layer, and a Work item says
     * "With Jubilee since 12 Aug". `could_not_finish` and `stopped` both mean it is not going to
     * continue by itself.
     */
    const groupOf = (run: RunRow): RunGroup =>
      run.status === "working" || run.status === "paused"
        ? "working"
        : run.status === "finished"
          ? "finished"
          : "stopped";

    const inFilter = (run: RunRow, filter: RunListFilter): boolean => {
      const group = groupOf(run);
      // "All" is everything still open: a finished run is history, not activity.
      if (filter === "all") return group !== "finished";
      return group === filter;
    };

    // Every tab's count in one pass, so the board needs one request rather than five.
    const counts = Object.fromEntries(
      RunListFilter.options.map((f) => [f, runs.filter((r) => inFilter(r, f)).length]),
    ) as Record<RunListFilter, number>;

    const inView = runs.filter((r) => inFilter(r, q.filter));
    const shown = inView.slice(0, q.limit);

    // The work each run is advancing: its title, so a job leads to what a person owns, and its
    // steps, which are the only honest source of progress.
    const workIds = [
      ...new Set(shown.map((r) => r.work_item_id).filter((v): v is string => v !== null)),
    ];
    const degraded: RunListResponse["degraded"] = [];
    const items = new Map<string, WorkItemRow>();
    if (workIds.length > 0) {
      const r = await db
        .from("work_items")
        .select(WORK_ITEM_COLUMNS)
        .in("id", workIds)
        .is("deleted_at", null);
      if (r.error) {
        degraded.push({
          what: "The work each job belongs to",
          because: "The work item rows could not be read.",
        });
      } else {
        for (const row of WorkItemRow.array().parse(r.data ?? [])) items.set(row.id, row);
      }
    }
    const context = await loadRecordContext(db, org.id, [...items.values()], now);
    degraded.push(...context.degraded);

    // The last thing each shown run recorded doing, in its own words.
    const lastEvent = new Map<string, string>();
    if (shown.length > 0) {
      const r = await db
        .from("run_events")
        .select("id, run_id, seq, kind, message, created_at")
        .in(
          "run_id",
          shown.map((x) => x.id),
        )
        .order("seq", { ascending: true });
      if (r.error) {
        degraded.push({
          what: "What each job last did",
          because: "The run event rows could not be read.",
        });
      } else {
        for (const ev of RunEventRow.array().parse(r.data ?? []))
          lastEvent.set(ev.run_id, ev.message);
      }
    }

    const progressOf = (run: RunRow): number | null => {
      const item = run.work_item_id ? items.get(run.work_item_id) : undefined;
      if (!item || item.steps.length === 0) return null;
      const done = item.steps.filter((st) => st.state === "done").length;
      return Math.round((done / item.steps.length) * 100);
    };

    const body: RunListResponse = runListResponseSchema.parse({
      organization: { id: org.id, name: org.name },
      filter: q.filter,
      label: RUN_LIST_FILTER_LABELS[q.filter],
      generatedAt,
      groups: RunGroup.options.flatMap((key) => {
        const inGroup = shown.filter((r) => groupOf(r) === key);
        if (inGroup.length === 0) return [];
        return [
          {
            key,
            title: RUN_GROUP_LABELS[key],
            items: inGroup.map((run) => {
              const item = run.work_item_id ? items.get(run.work_item_id) : undefined;
              const waiting = run.status === "paused" || runNeedsPerson(run);
              return {
                run,
                group: key,
                progress: progressOf(run),
                lastEvent: lastEvent.get(run.id) ?? null,
                waitingFor: waiting ? run.next_step : null,
                needsPerson: runNeedsPerson(run),
                work: item ? { id: item.id, title: item.title } : null,
                client:
                  item?.client_id && context.clientNames.has(item.client_id)
                    ? { id: item.client_id, name: context.clientNames.get(item.client_id)! }
                    : null,
                period: item?.policy_period_id
                  ? (context.periods.get(item.policy_period_id) ?? null)
                  : null,
              };
            }),
          },
        ];
      }),
      counts,
      visible: inView.length,
      returned: shown.length,
      cap: q.limit,
      degraded,
    });
    return c.json(body);
  });

  app.get("/runs/:id", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const run = await loadRun(db, id);
    const events = await loadEvents(db, id, 0);

    let relatedWork: RunDetailResponse["relatedWork"] = null;
    let evidence: RunDetailResponse["evidence"] = [];
    let stepMoved = false;
    if (run.work_item_id) {
      const { data, error } = await db
        .from("work_items")
        .select(WORK_ITEM_COLUMNS)
        .eq("id", run.work_item_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return sendError(c, mapDatabaseError(error));
      if (data) {
        const item = WorkItemRow.parse(data);
        const now = item.steps.find((st) => st.state === "now" || st.state === "blocked");
        relatedWork = {
          id: item.id,
          title: item.title,
          taskStatus: item.task_status,
          nowStep: now?.label ?? null,
        };
        evidence = item.steps
          .flatMap((st) =>
            st.recorded.map((r) => ({
              label: st.label,
              reference: r.reference,
              recordedBy: r.recordedBy,
              recordedAt: r.recordedAt,
            })),
          )
          .slice(0, 20);
        // The step the run was working on has since been completed by someone else.
        const ranOn = item.steps.find((st) => st.runId === run.id);
        stepMoved = ranOn !== undefined && ranOn.state === "done";
      }
    }

    const unfinished = run.status === "could_not_finish" || run.status === "stopped";
    const recovery: RunDetailResponse["recovery"] = [];
    if (relatedWork) {
      recovery.push({ kind: "open_work", label: "Open the work", disabledReason: null });
    }
    if (unfinished) {
      recovery.push({
        kind: "retry",
        label: "Start it again",
        disabledReason: !relatedWork
          ? "This run has no work item, so there is nothing to start again."
          : stepMoved
            ? "The step this was working on has since been completed. Open the work instead."
            : // Starting a run is an action on a step, and the step owns its own guards.
              "Start it again from the step on the record, so its guards are checked.",
      });
    }

    const body: RunDetailResponse = runDetailResponseSchema.parse({
      run,
      events,
      relatedWork,
      evidence,
      // A run says what it is waiting for in its own words, never a business outcome.
      waitingFor: run.status === "paused" || unfinished ? run.next_step : null,
      recovery,
    });
    return c.json(body);
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

/** The fields that changed, as "field: before → after". Never the whole row, never a document. */
function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const out: string[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const show = (v: unknown) =>
      v === undefined || v === null
        ? "nothing"
        : typeof v === "object"
          ? Array.isArray(v)
            ? `${v.length} item${v.length === 1 ? "" : "s"}`
            : "changed"
          : String(v).slice(0, 80);
    out.push(before && after ? `${k}: ${show(b)} → ${show(a)}` : `${k}: ${show(a ?? b)}`);
  }
  return out.slice(0, 20);
}

/** Evidence references recorded with an action, flattened to the strings a person recorded. */
function evidenceRefs(evidence: unknown): string[] {
  if (evidence === null || evidence === undefined) return [];
  if (Array.isArray(evidence)) {
    return evidence
      .map((e) =>
        typeof e === "string"
          ? e
          : typeof e === "object" && e !== null && "reference" in e
            ? String((e as { reference: unknown }).reference)
            : null,
      )
      .filter((v): v is string => v !== null)
      .slice(0, 10);
  }
  if (typeof evidence === "object" && "reference" in (evidence as object)) {
    return [String((evidence as { reference: unknown }).reference)];
  }
  return [];
}

/** One audit row as it is selected above. Shared by the record history and the brokerage's own. */
type AuditRow = {
  id: number | string;
  actor_type: HistoryEntry["actorType"];
  actor_user_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  evidence: unknown;
  result: HistoryEntry["result"];
  failure_reason: string | null;
  occurred_at: string;
};

type ResolvedRecord = {
  client: { id: string; name: string } | null;
  record: { type: string; id: string; label: string } | null;
  workItemId: string | null;
};

/**
 * The client, record and Work item each audit row is about, read under the caller's own session
 * (RLS applies: a record the caller cannot see stays unnamed). Nothing is written.
 */
async function resolveRecords(db: SupabaseClient, rows: AuditRow[]): Promise<Map<string, ResolvedRecord>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) if (r.object_id) (byType.get(r.object_type) ?? byType.set(r.object_type, new Set()).get(r.object_type)!).add(r.object_id);
  const ids = (t: string) => [...(byType.get(t) ?? [])];
  type Row = { id: string; client_id?: string | null; work_item_id?: string | null; title?: string | null; filename?: string | null; policy_number?: string | null; incident_summary?: string | null; name?: string };
  const read = async (table: string, cols: string, list: string[]) => (list.length ? (((await db.from(table).select(cols).in("id", list)).data ?? []) as unknown as Row[]) : []);
  const [work, opps, placements, claims, docs, policies, clientsDirect] = await Promise.all([
    read("work_items", "id, client_id, title", ids("work_item")),
    read("opportunities", "id, client_id, work_item_id, title", ids("opportunity")),
    read("placements", "id, client_id, work_item_id", ids("placement")),
    read("claims", "id, client_id, work_item_id, incident_summary", ids("claim")),
    read("documents", "id, client_id, work_item_id, filename", ids("document")),
    read("policies", "id, client_id, policy_number", ids("policy")),
    read("clients", "id, name", ids("client")),
  ]);
  // A workflow run (D-129) is about its Work item and the client named in its facts.
  const wfIds = ids("workflow_run");
  const wfRuns = wfIds.length ? (((await db.from("workflow_runs").select("id, work_item_id, facts").in("id", wfIds)).data ?? []) as { id: string; work_item_id: string | null; facts: { clientId?: string } }[]) : [];
  const clientIds = new Set<string>([...clientsDirect.map((c) => c.id)]);
  for (const r of [...work, ...opps, ...placements, ...claims, ...docs, ...policies]) if (r.client_id) clientIds.add(r.client_id);
  for (const r of wfRuns) if (r.facts?.clientId) clientIds.add(r.facts.clientId);
  const clientNames = new Map<string, string>();
  for (const c of await read("clients", "id, name", [...clientIds])) clientNames.set(c.id, c.name ?? "");
  const client = (id: string | null | undefined) => (id && clientNames.has(id) ? { id, name: clientNames.get(id)! } : null);
  const out = new Map<string, ResolvedRecord>();
  const put = (type: string, r: Row, label: string, workItemId: string | null) =>
    out.set(`${type}:${r.id}`, { client: client(type === "client" ? r.id : r.client_id), record: { type, id: r.id, label }, workItemId });
  for (const r of work) put("work_item", r, r.title ?? "Work", r.id);
  for (const r of opps) put("opportunity", r, r.title ?? "Quotation", r.work_item_id ?? null);
  for (const r of placements) put("placement", r, "Placement", r.work_item_id ?? null);
  for (const r of claims) put("claim", r, "Claim" + (r.incident_summary ? " — " + r.incident_summary.slice(0, 60) : ""), r.work_item_id ?? null);
  for (const r of docs) put("document", r, r.filename ?? "Document", r.work_item_id ?? null);
  for (const r of policies) put("policy", r, r.policy_number ?? "Policy (number not recorded)", null);
  for (const r of clientsDirect) put("client", r, r.name ?? "Client", null);
  for (const r of wfRuns)
    out.set(`workflow_run:${r.id}`, { client: client(r.facts?.clientId), record: { type: "workflow_run", id: r.id, label: (r.work_item_id && work.find((w) => w.id === r.work_item_id)?.title) || "Renewal" }, workItemId: r.work_item_id });
  return out;
}

/**
 * Audit rows as history a person can read: actor names instead of ids, and the fields that
 * changed rather than the whole row. Nothing is redacted a second time here — `audit.ts` refuses
 * to write document contents or credentials in the first place.
 */
async function summariseHistory(
  db: SupabaseClient,
  recordId: string | null,
  rows: AuditRow[],
): Promise<HistoryResponse> {
  const actorIds = [
    ...new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => v !== null)),
  ];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const u = await db.from("users").select("id, full_name, email").in("id", actorIds);
    for (const row of (u.data ?? []) as { id: string; full_name: string | null; email: string }[]) {
      names.set(row.id, row.full_name ?? row.email);
    }
  }
  const records = await resolveRecords(db, rows);
  const ACTOR_LABEL = { user: "A person", ai: "ASAP", automation: "An automation", system: "The platform" } as const;
  return historyResponseSchema.parse({
    recordId,
    entries: rows.map((r) => ({
      id: String(r.id),
      actorType: r.actor_type,
      actorName: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : null,
      actorId: r.actor_user_id,
      actorLabel: ACTOR_LABEL[r.actor_type],
      ...(r.object_id && records.has(`${r.object_type}:${r.object_id}`)
        ? records.get(`${r.object_type}:${r.object_id}`)!
        : { client: null, record: null, workItemId: r.object_type === "work_item" ? r.object_id : null }),
      external: /(^|\.)(email\.sent|send|sent_external|delivered)\b|email_send/i.test(r.action) && r.result === "success",
      coverOrMoney: /^(placement|issuance|policy|payment|invoice|commission|money|cover)\b|\.(issued|applied_to_policy|cover_confirmed|paid)\b/i.test(r.object_type + "." + r.action) || /^(placement|policy)$/.test(r.object_type),
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      result: r.result,
      failureReason: r.failure_reason,
      changed: changedFields(r.previous_state, r.new_state),
      evidence: evidenceRefs(r.evidence),
      occurredAt: r.occurred_at,
    })),
    visible: rows.length,
    returned: rows.length,
  });
}
