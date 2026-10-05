import { insurerStage, quotationNext, workStateFrom } from "../quotation/next.js";
import {
  createOpportunityRequestSchema,
  opportunityActionResponseSchema,
  opportunityActionSchema,
  opportunityListResponseSchema,
  opportunityResponseSchema,
  updateOpportunityRequestSchema,
  type EvidenceRef,
  type OpportunityResponse,
  type QuoteTermType,
} from "@asap/schema";
import { pgMoney } from "../numeric.js";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { emitEvent } from "../events/emit.js";
import { approveQuoteRequest, prepareQuoteRequest, recordQuoteDelivery, quoteRequestDigest } from "../quotation/requests.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * A client needs cover, and the market answers.
 *
 * Every write here goes through one action contract, and every one of them is refused rather than
 * fudged when the facts do not support it: a request cannot be approved until it exists, a quote
 * cannot be recorded without saying where it came from, an insurer cannot be approached twice, and
 * nothing at all can be marked sent, because nothing in this deployment can send.
 *
 * The idempotency story is the same everywhere and is the database's, not this file's: a unique
 * index refuses the second of anything, and this code reads what won rather than racing it.
 */

/**
 * The canonical digest an approval covers. This must stay identical to `app.quote_request_digest`
 * in migration 0049 — a check constraint recomputes it in the database, so a divergence here is a
 * failed write rather than a quiet disagreement. The separator is a record separator character,
 * which cannot occur in a subject line; without one, a subject ending "x" with body "y" and a
 * subject "x" with body starting "y" would hash alike.
 */
export { quoteRequestDigest };

/** No response shape carries a status. What has happened is read from the rows. */
export function opportunityRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  /** Every opportunity of this brokerage, newest first. */
  app.get("/opportunities", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const rows = await db
      .from("opportunities")
      .select("id, title, client_id, class_of_business, created_at, closed_at")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (rows.error) return sendError(c, mapDatabaseError(rows.error));
    const list = (rows.data ?? []) as {
      id: string;
      title: string;
      client_id: string;
      class_of_business: string;
      created_at: string;
      closed_at: string | null;
    }[];

    const clientNames = await namesFor(db, "clients", org.id, list.map((o) => o.client_id));
    const approaches = await db
      .from("opportunity_insurers")
      .select("id, opportunity_id, removed_at")
      .eq("organization_id", org.id)
      .in("opportunity_id", list.map((o) => o.id));
    const responses = await db
      .from("insurer_responses")
      .select("opportunity_id, outcome")
      .eq("organization_id", org.id)
      .in("opportunity_id", list.map((o) => o.id));

    const live = new Map<string, number>();
    for (const a of (approaches.data ?? []) as { opportunity_id: string; removed_at: string | null }[]) {
      if (a.removed_at === null) live.set(a.opportunity_id, (live.get(a.opportunity_id) ?? 0) + 1);
    }
    const quoted = new Map<string, number>();
    for (const r of (responses.data ?? []) as { opportunity_id: string; outcome: string }[]) {
      if (r.outcome === "quoted") quoted.set(r.opportunity_id, (quoted.get(r.opportunity_id) ?? 0) + 1);
    }

    return c.json(
      opportunityListResponseSchema.parse({
        opportunities: list.map((o) => ({
          id: o.id,
          title: o.title,
          clientId: o.client_id,
          clientName: clientNames.get(o.client_id) ?? "",
          classOfBusiness: o.class_of_business,
          createdAt: o.created_at,
          closedAt: o.closed_at,
          insurerCount: live.get(o.id) ?? 0,
          quotedCount: quoted.get(o.id) ?? 0,
        })),
      }),
    );
  });

  /**
   * Start quotation work.
   *
   * Creates the work item a person owns and the opportunity beside it, and copies the class's
   * requirement templates in — so what the brokerage says a commercial motor request needs is
   * data it can change, not a list in code. Idempotent on the browser's request key: a double
   * submit finds the opportunity the first one made.
   */
  app.post("/opportunities", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createOpportunityRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "space", "create")) {
      throw new HttpError(403, "not_permitted", "You may not start work in this brokerage.");
    }

    const client = await db
      .from("clients")
      .select("id, name")
      .eq("organization_id", org.id)
      .eq("id", input.clientId)
      .is("deleted_at", null)
      .maybeSingle();
    if (client.error) return sendError(c, mapDatabaseError(client.error));
    if (!client.data) throw new HttpError(404, "not_found", "No client with that id");
    const clientRow = client.data as { id: string; name: string };

    /*
     * The work item carries the request key, so the engine's own idempotency (0029, 0023) decides
     * what a second submit does. Reading the opportunity back by work item is then enough: one
     * opportunity per work item is a unique constraint.
     */
    const created = await db.rpc("work_item_create", {
      p_organization_id: org.id,
      p_kind: "new_business",
      p_title: input.title,
      p_client_name: clientRow.name,
      p_steps: [],
      p_task_status: "needs_you",
      p_task_party: null,
      p_client_id: clientRow.id,
      p_insurer_id: null,
      p_class_of_business: input.classOfBusiness,
    });
    if (created.error) return sendError(c, mapDatabaseError(created.error));
    const { id: workItemId } = created.data as { id: string; reopened: boolean };

    const existing = await db
      .from("opportunities")
      .select("id, client_id")
      .eq("organization_id", org.id)
      .eq("work_item_id", workItemId)
      .maybeSingle();
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));
    /*
     * The engine finds work by its title (0026), not its client: the same title for another client
     * would hand back that client's quotation. Refused, never merged — one client's work must not
     * collect another's insurers, requirements or requests.
     */
    const found = existing.data as { id: string; client_id: string } | null;
    if (found && found.client_id !== clientRow.id) {
      throw new HttpError(409, "title_in_use", "Another client already has quotation work with this exact title. Give this one a title of its own — for example with the client's name in it. Nothing was created.");
    }

    let opportunityId = (existing.data as { id: string } | null)?.id ?? null;
    if (opportunityId === null) {
      const inserted = await db
        .from("opportunities")
        .insert({
          organization_id: org.id,
          client_id: clientRow.id,
          work_item_id: workItemId,
          title: input.title,
          class_of_business: input.classOfBusiness,
          risk_summary: input.riskSummary ?? null,
          cover_start: input.coverStart ?? null,
          cover_end: input.coverEnd ?? null,
          source_email_message_id: input.sourceEmailMessageId ?? null,
          source_document_id: input.sourceDocumentId ?? null,
          owner_id: user.id,
          created_by: user.id,
        })
        .select("id")
        .maybeSingle();
      if (inserted.error || !inserted.data) {
        /* Another submit won the race. Read what it made rather than failing this one. */
        const again = await db
          .from("opportunities")
          .select("id")
          .eq("organization_id", org.id)
          .eq("work_item_id", workItemId)
          .maybeSingle();
        if (!again.data) return sendError(c, mapDatabaseError(inserted.error ?? { message: "insert failed" }));
        opportunityId = (again.data as { id: string }).id;
      } else {
        opportunityId = (inserted.data as { id: string }).id;

        /* What this class needs, from the brokerage's own configuration. */
        const templates = await db
          .from("requirement_templates")
          .select("label, required, position")
          .eq("organization_id", org.id)
          .eq("class_of_business", input.classOfBusiness)
          .order("position", { ascending: true });
        const rows = (templates.data ?? []) as { label: string; required: boolean; position: number }[];
        if (rows.length > 0) {
          await db.from("opportunity_requirements").insert(
            rows.map((t) => ({
              organization_id: org.id,
              opportunity_id: opportunityId,
              label: t.label,
              required: t.required,
              position: t.position,
            })),
          );
        }

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.created",
          objectType: "opportunity",
          objectId: opportunityId,
          result: "success",
          newState: { title: input.title, classOfBusiness: input.classOfBusiness, clientId: clientRow.id },
        });
      }
    }

    // From its first moment the work item carries the same next action as the quotation (D-120).
    await syncQuotationWork(db, await loadOpportunity(db, ctx, org.id, opportunityId));
    // Quotation work was opened (D-141): the quotation run starts. Once per opportunity.
    await emitEvent(db, deps.logger, { organizationId: org.id, eventType: "opportunity.opened", entityType: "opportunity", entityId: opportunityId, actor: "user", actorUserId: user.id, payload: { opportunityId, workItemId }, dedupeKey: opportunityId });
    return c.json({ opportunityId, workItemId }, 201);
  });

  app.get("/opportunities/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(opportunityResponseSchema.parse(await loadOpportunity(db, ctx, org.id, c.req.param("id"))));
  });

  app.patch("/opportunities/:id", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, updateOpportunityRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    if (!hasPermission(ctx, "space", "create")) {
      throw new HttpError(403, "not_permitted", "You may not change this quotation work.");
    }
    if (Object.keys(input).length === 0) {
      throw new HttpError(400, "invalid_request", "Say what to change.");
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) patch["title"] = input.title;
    if (input.riskSummary !== undefined) patch["risk_summary"] = input.riskSummary;
    if (input.coverStart !== undefined) patch["cover_start"] = input.coverStart;
    if (input.coverEnd !== undefined) patch["cover_end"] = input.coverEnd;

    const updated = await db
      .from("opportunities")
      .update(patch)
      .eq("organization_id", org.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (updated.error) return sendError(c, mapDatabaseError(updated.error));
    if (!updated.data) throw new HttpError(404, "not_found", "No opportunity with that id");

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "opportunity.updated",
      objectType: "opportunity",
      objectId: id,
      result: "success",
      newState: patch,
    });

    return c.json(opportunityResponseSchema.parse(await loadOpportunity(db, ctx, org.id, id)));
  });

  /**
   * Everything a person does to an opportunity, through one contract.
   *
   * `blocked` is a real outcome with the guard's own reason, and `already` means the thing was
   * done before — neither is an error, and neither pretends to be a success.
   */
  app.post("/opportunities/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, opportunityActionSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const opp = await db
      .from("opportunities")
      .select("id, class_of_business, closed_at")
      .eq("organization_id", org.id)
      .eq("id", id)
      .maybeSingle();
    if (opp.error) return sendError(c, mapDatabaseError(opp.error));
    if (!opp.data) throw new HttpError(404, "not_found", "No opportunity with that id");
    const closed = (opp.data as { closed_at: string | null }).closed_at !== null;

    const blocked = async (reason: string) =>
      c.json(
        opportunityActionResponseSchema.parse({
          outcome: "blocked",
          reason,
          opportunity: await loadOpportunity(db, ctx, org.id, id),
        }),
      );
    const done = async (outcome: "done" | "already" = "done") => {
      const opportunity = await loadOpportunity(db, ctx, org.id, id);
      // The work item carries the same next action the Space shows (D-119).
      await syncQuotationWork(db, opportunity);
      // Something on the quotation changed (an insurer added, a requirement supplied, a delivery
      // recorded): the quotation run waiting on it looks again (D-141). Not a fact to dedupe.
      if (outcome === "done") await emitEvent(db, deps.logger, { organizationId: org.id, eventType: "opportunity.changed", entityType: "opportunity", entityId: id, actor: "user", actorUserId: user.id, payload: { opportunityId: id, action: input.action, workItemId: opportunity.workItem.id } });
      return c.json(opportunityActionResponseSchema.parse({ outcome, reason: null, opportunity }));
    };

    /* Approving is its own permission; everything else is ordinary quotation work. */
    const needsApproval = input.action === "approve_request";
    if (needsApproval && !hasPermission(ctx, "email", "approve")) {
      return blocked("You may not approve messages going out of this brokerage.");
    }
    if (!needsApproval && !hasPermission(ctx, "space", "create")) {
      // A refused action is still an attempt, and attempts are audited (D-026).
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: `opportunity.${input.action}`,
        objectType: "opportunity",
        objectId: id,
        result: "denied",
        failureReason: "permission_denied",
      });
      return blocked("You may not change this quotation work.");
    }
    if (closed && input.action !== "close") {
      return blocked("This quotation work is closed. Nothing more is recorded against it.");
    }

    const now = new Date().toISOString();

    /**
     * One insurer approached on this quotation. Already approached is read rather than raced (the
     * unique index would refuse it); a lost race reads the winner's row.
     */
    const addApproach = async (
      insurerId: string,
    ): Promise<{ opportunityInsurerId: string; added: boolean; error: null } | { error: HttpError }> => {
      const read = async () =>
        (
          await db
            .from("opportunity_insurers")
            .select("id, removed_at")
            .eq("organization_id", org.id)
            .eq("opportunity_id", id)
            .eq("insurer_id", insurerId)
            .is("removed_at", null)
            .maybeSingle()
        ).data as { id: string } | null;
      const live = await read();
      if (live) return { opportunityInsurerId: live.id, added: false, error: null };
      const added = await db
        .from("opportunity_insurers")
        .insert({ organization_id: org.id, opportunity_id: id, insurer_id: insurerId, added_by: user.id })
        .select("id")
        .maybeSingle();
      if (added.error || !added.data) {
        const winner = await read();
        if (winner) return { opportunityInsurerId: winner.id, added: false, error: null };
        return { error: mapDatabaseError(added.error ?? { message: "The insurer could not be added" }) };
      }
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "opportunity.insurer_added",
        objectType: "opportunity",
        objectId: id,
        result: "success",
        newState: { insurerId },
      });
      return { opportunityInsurerId: (added.data as { id: string }).id, added: true, error: null };
    };

    switch (input.action) {
      case "add_insurer": {
        const insurer = await db
          .from("insurers")
          .select("id")
          .eq("organization_id", org.id)
          .eq("id", input.insurerId)
          .maybeSingle();
        if (!insurer.data) return blocked("That insurer is not in this brokerage.");
        const approach = await addApproach(input.insurerId);
        if (approach.error) return sendError(c, approach.error);
        return done(approach.added ? "done" : "already");
      }

      case "approach_insurers": {
        const on = await db
          .from("insurers")
          .select("id, name")
          .eq("organization_id", org.id)
          .is("deleted_at", null);
        if (on.error) return sendError(c, mapDatabaseError(on.error));
        const onFile = (on.data ?? []) as { id: string; name: string }[];

        /* Every name resolves, or nothing is written: a half-applied list is harder to read than a refusal. */
        const wanted: { id: string | null; name: string }[] = [];
        for (const item of input.insurers) {
          if (item.insurerId) {
            const hit = onFile.find((i) => i.id === item.insurerId);
            if (!hit) return blocked("That insurer is not in this brokerage.");
            wanted.push({ id: hit.id, name: hit.name });
            continue;
          }
          const match = matchInsurerName(item.name!, onFile);
          if (match.outcome === "many")
            return blocked(`“${item.name}” matches ${match.names.join(" and ")} — say which. Nothing was changed.`);
          wanted.push(match.outcome === "one" ? { id: match.id, name: match.name } : { id: null, name: item.name! });
        }

        const results: { insurerId: string; insurerName: string; newOnFile: boolean; approach: "added" | "already"; request: "prepared" | "already" | "not_requested" }[] = [];
        const seen = new Set<string>();
        for (const w of wanted) {
          let insurerId = w.id;
          let newOnFile = false;
          if (!insurerId) {
            /* Idempotent on the brokerage and the name (0026): a retry finds the same insurer. */
            const made = await db.rpc("insurer_create", { p_organization_id: org.id, p_name: w.name });
            if (made.error || !made.data) return sendError(c, mapDatabaseError(made.error ?? { message: "insurer_create returned nothing" }));
            insurerId = made.data as string;
            newOnFile = true;
            await recordAudit(db, deps.logger, c, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "insurer.created",
              objectType: "insurer",
              objectId: insurerId,
              result: "success",
              newState: { name: w.name, from: "quotation", opportunityId: id },
            });
          }
          if (seen.has(insurerId)) continue;
          seen.add(insurerId);

          const approach = await addApproach(insurerId);
          if (approach.error) return sendError(c, approach.error);
          let request: "prepared" | "already" | "not_requested" = "not_requested";
          if (input.prepare) {
            const existing = await db
              .from("quote_requests")
              .select("id")
              .eq("organization_id", org.id)
              .eq("opportunity_insurer_id", approach.opportunityInsurerId)
              .maybeSingle();
            /* A request already there may hold a person's edits or an approval: it is never overwritten here. */
            if (existing.data) request = "already";
            else {
              const view = await loadOpportunity(db, ctx, org.id, id);
              const draft = composeQuoteRequest(view, w.name);
              const inserted = await db
                .from("quote_requests")
                .insert({
                  organization_id: org.id,
                  opportunity_id: id,
                  opportunity_insurer_id: approach.opportunityInsurerId,
                  subject: draft.subject,
                  body_text: draft.body,
                  prepared_by: user.id,
                })
                .select("id")
                .maybeSingle();
              if (inserted.error || !inserted.data) request = "already";
              else {
                request = "prepared";
                await recordAudit(db, deps.logger, c, {
                  organizationId: org.id,
                  actorUserId: user.id,
                  action: "opportunity.request_prepared",
                  objectType: "opportunity",
                  objectId: id,
                  result: "success",
                  newState: { opportunityInsurerId: approach.opportunityInsurerId, subject: draft.subject, sent: false },
                });
              }
            }
          }
          results.push({ insurerId, insurerName: w.name, newOnFile, approach: approach.added ? "added" : "already", request });
        }

        const opportunity = await loadOpportunity(db, ctx, org.id, id);
        await syncQuotationWork(db, opportunity);
        const anything = results.some((r) => r.newOnFile || r.approach === "added" || r.request === "prepared");
        return c.json(
          opportunityActionResponseSchema.parse({ outcome: anything ? "done" : "already", reason: null, opportunity, results }),
        );
      }

      case "remove_insurer": {
        const updated = await db
          .from("opportunity_insurers")
          .update({ removed_at: now, removed_by: user.id, removed_reason: input.reason })
          .eq("organization_id", org.id)
          .eq("id", input.opportunityInsurerId)
          .is("removed_at", null)
          .select("id")
          .maybeSingle();
        if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        if (!updated.data) return done("already");

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.insurer_removed",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { opportunityInsurerId: input.opportunityInsurerId, reason: input.reason },
        });
        return done();
      }

      case "add_requirement": {
        const added = await db
          .from("opportunity_requirements")
          .insert({ organization_id: org.id, opportunity_id: id, label: input.label })
          .select("id")
          .maybeSingle();
        /* The unique index makes a repeated label the same requirement, not a second one. */
        if (added.error || !added.data) return done("already");
        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.requirement_added",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { requirementId: (added.data as { id: string }).id, label: input.label },
        });
        return done();
      }

      case "supply_requirement": {
        if (
          input.documentId === undefined &&
          input.emailMessageId === undefined &&
          (input.note ?? "").trim().length < 10
        ) {
          // A note is evidence only if it says something: "ok" or "x" proves nothing.
          return blocked("Say what proves this: a document, an email, or a note of at least ten characters.");
        }
        const current = await db
          .from("opportunity_requirements")
          .select("id, supplied_at")
          .eq("organization_id", org.id)
          .eq("opportunity_id", id)
          .eq("id", input.requirementId)
          .maybeSingle();
        if (!current.data) return blocked("That requirement is not part of this quotation work.");
        /* Supplied already: a retry or a second click records nothing new. */
        if ((current.data as { supplied_at: string | null }).supplied_at !== null) return done("already");
        const updated = await db
          .from("opportunity_requirements")
          .update({
            supplied_at: now,
            supplied_by: user.id,
            evidence_document_id: input.documentId ?? null,
            evidence_email_message_id: input.emailMessageId ?? null,
            evidence_note: input.note ?? null,
          })
          .eq("organization_id", org.id)
          .eq("id", input.requirementId)
          .select("id")
          .maybeSingle();
        if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        if (!updated.data) return blocked("That requirement is not part of this quotation work.");

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.requirement_supplied",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { requirementId: input.requirementId },
        });
        return done();
      }

      case "prepare_request": {
        // The one shared path (D-141): the same guards a workflow step meets.
        const prepared = await prepareQuoteRequest(db, { organizationId: org.id, opportunityId: id, opportunityInsurerId: input.opportunityInsurerId, subject: input.subject, body: input.body, preparedBy: user.id, now });
        if (prepared.outcome === "blocked") return blocked(prepared.reason);

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.request_prepared",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          /* The subject, never the body: a request can quote the client's own information. */
          newState: { opportunityInsurerId: input.opportunityInsurerId, subject: input.subject },
        });
        return done();
      }

      case "approve_request": {
        // The one shared path (D-141): the approval names the person, and covers this exact text.
        const approved = await approveQuoteRequest(db, { organizationId: org.id, quoteRequestId: input.quoteRequestId, approverId: user.id, now });
        if (approved.outcome === "blocked") return blocked(approved.reason);
        if (approved.outcome === "already") return done("already");
        const row = { id: input.quoteRequestId };

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.request_approved",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { quoteRequestId: row.id, approvedAt: now },
        });
        return done();
      }

      case "record_delivery": {
        const deliveredAt = input.deliveredAt ?? now;
        const r = await recordQuoteDelivery(db, { organizationId: org.id, opportunityId: id, quoteRequestId: input.quoteRequestId, method: input.method, reference: input.reference, deliveredAt, evidenceDocumentId: input.evidenceDocumentId ?? null, userId: user.id });
        if (r.outcome === "blocked") return blocked(r.reason);
        if (r.outcome === "already") return done("already");
        if (r.outcome === "error") return sendError(c, mapDatabaseError(r.error));
        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.request_delivered",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { quoteRequestId: input.quoteRequestId, method: input.method, deliveredAt, reference: input.reference, evidenceDocumentId: input.evidenceDocumentId ?? null },
        });
        return done();
      }

      case "record_response": {
        /*
         * A reply answers a request the insurer holds. Recording one against an insurer nobody
         * asked is allowed only when the person says so explicitly — a phone answer, a request
         * that went out before ASAP — and the record says it arrived without one.
         */
        if (!input.withoutRequest) {
          const approach = await db
            .from("quote_requests")
            .select("id")
            .eq("organization_id", org.id)
            .eq("opportunity_insurer_id", input.opportunityInsurerId)
            .maybeSingle();
          const reqId = (approach.data as { id: string } | null)?.id ?? null;
          const delivered = reqId
            ? await db.from("quote_request_deliveries").select("id").eq("organization_id", org.id).eq("quote_request_id", reqId).maybeSingle()
            : { data: null };
          if (!delivered.data) {
            return blocked("No request has been delivered to this insurer yet. Record the delivery first — or, if they replied without one, record it as received without a request.");
          }
        }
        if (input.outcome === "quoted") {
          if (
            input.sourceDocumentId === undefined &&
            input.sourceEmailMessageId === undefined &&
            (input.sourceNote ?? "").trim() === ""
          ) {
            return blocked("Say where these terms came from: a document, an email, or a note.");
          }
        }
        if (input.outcome === "declined" && (input.declineReason ?? "").trim() === "") {
          return blocked("A decline has to say why.");
        }

        const approach = await db
          .from("opportunity_insurers")
          .select("id")
          .eq("organization_id", org.id)
          .eq("id", input.opportunityInsurerId)
          .maybeSingle();
        if (!approach.data) return blocked("That insurer is not part of this quotation work.");

        const row = {
          organization_id: org.id,
          opportunity_id: id,
          opportunity_insurer_id: input.opportunityInsurerId,
          outcome: input.outcome,
          received_at: input.outcome === "no_response" ? null : (input.receivedAt ?? now),
          source_email_message_id: input.sourceEmailMessageId ?? null,
          source_document_id: input.sourceDocumentId ?? null,
          source_note: input.sourceNote ?? null,
          premium_amount: input.outcome === "quoted" ? (input.premiumAmount ?? null) : null,
          premium_currency: input.outcome === "quoted" ? (input.premiumCurrency ?? null) : null,
          valid_until: input.validUntil ?? null,
          decline_reason: input.declineReason ?? null,
          recorded_by: user.id,
          updated_at: now,
        };

        const existing = await db
          .from("insurer_responses")
          .select("id")
          .eq("organization_id", org.id)
          .eq("opportunity_insurer_id", input.opportunityInsurerId)
          .maybeSingle();

        let responseId: string;
        if (existing.data) {
          responseId = (existing.data as { id: string }).id;
          const updated = await db
            .from("insurer_responses")
            .update(row)
            .eq("organization_id", org.id)
            .eq("id", responseId)
            .select("id")
            .maybeSingle();
          if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        } else {
          const inserted = await db.from("insurer_responses").insert(row).select("id").maybeSingle();
          if (inserted.error || !inserted.data) return done("already");
          responseId = (inserted.data as { id: string }).id;
        }

        // The insurer has answered (D-140): once per response and outcome, so a quotation run waiting
        // on this insurer wakes. A "no response" is not an answer and wakes nothing.
        if (input.outcome !== "no_response") {
          const w = await db.from("opportunities").select("work_item_id").eq("organization_id", org.id).eq("id", id).maybeSingle();
          await emitEvent(db, deps.logger, {
            organizationId: org.id,
            eventType: "quote.received",
            entityType: "opportunity",
            entityId: id,
            actor: "user",
            actorUserId: user.id,
            payload: { insurerResponseId: responseId, opportunityInsurerId: input.opportunityInsurerId, outcome: input.outcome, workItemId: (w.data as { work_item_id: string | null } | null)?.work_item_id ?? null },
            dedupeKey: `${responseId}:${input.outcome}`,
          });
        }

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.response_recorded",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          /* The outcome and the premium, never the insurer's own wording. */
          newState: {
            opportunityInsurerId: input.opportunityInsurerId,
            outcome: input.outcome,
            premiumAmount: pgMoney(row.premium_amount),
            premiumCurrency: row.premium_currency,
          },
        });
        return done();
      }

      case "record_term": {
        const response = await db
          .from("insurer_responses")
          .select("id")
          .eq("organization_id", org.id)
          .eq("id", input.insurerResponseId)
          .maybeSingle();
        if (!response.data) return blocked("That response is not part of this quotation work.");

        const inserted = await db
          .from("quote_terms")
          .insert({
            organization_id: org.id,
            insurer_response_id: input.insurerResponseId,
            term_type: input.termType,
            label: input.label,
            extracted_value: input.extractedValue ?? null,
            amount: input.amount ?? null,
            currency: input.currency ?? null,
            unclear: input.unclear ?? false,
            evidence_document_id: input.evidenceDocumentId ?? null,
            evidence_page: input.evidencePage ?? null,
          })
          .select("id")
          .maybeSingle();
        /* The same term twice is the same term: the unique index says so. */
        if (inserted.error || !inserted.data) return done("already");
        return done();
      }

      case "correct_term": {
        const term = await db
          .from("quote_terms")
          .select("id, insurer_response_id")
          .eq("organization_id", org.id)
          .eq("id", input.termId)
          .maybeSingle();
        if (!term.data) return blocked("That term is not part of this quotation work.");

        /*
         * The correction is written beside the extracted value, never over it. The constraint
         * makes a half-correction impossible; this only ever writes all three together.
         */
        const updated = await db
          .from("quote_terms")
          .update({
            corrected_value: input.correctedValue,
            corrected_by: user.id,
            corrected_at: now,
          })
          .eq("organization_id", org.id)
          .eq("id", input.termId)
          .select("id")
          .maybeSingle();
        if (updated.error) return sendError(c, mapDatabaseError(updated.error));

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.term_corrected",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { termId: input.termId },
        });
        return done();
      }

      case "close": {
        const updated = await db
          .from("opportunities")
          .update({
            closed_at: now,
            closed_outcome: input.outcome,
            closed_reason: input.reason,
            updated_at: now,
          })
          .eq("organization_id", org.id)
          .eq("id", id)
          .is("closed_at", null)
          .select("id")
          .maybeSingle();
        if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        if (!updated.data) return done("already");

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.closed",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { outcome: input.outcome, reason: input.reason },
        });
        return done();
      }
    }
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}

/* ---- Reading one opportunity ---------------------------------------------------------------- */

type Ctx = Awaited<ReturnType<typeof resolveContext>>;

async function namesFor(
  db: SupabaseClient,
  table: string,
  organizationId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await db
    .from(table)
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", [...new Set(ids)]);
  for (const r of (data ?? []) as { id: string; name: string }[]) out.set(r.id, r.name);
  return out;
}

export async function loadOpportunity(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  id: string,
): Promise<OpportunityResponse> {
  const oppQ = await db
    .from("opportunities")
    .select(
      "id, client_id, work_item_id, title, class_of_business, risk_summary, cover_start, cover_end, source_email_message_id, source_document_id, owner_id, created_at, closed_at, closed_outcome, closed_reason",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (oppQ.error) throw mapDatabaseError(oppQ.error);
  if (!oppQ.data) throw new HttpError(404, "not_found", "No opportunity with that id");
  const o = oppQ.data as Record<string, string | null> & { id: string; work_item_id: string; client_id: string };

  const [clientQ, workQ, reqQ, insQ, allInsurersQ, docsQ] = await Promise.all([
    db.from("clients").select("id, name").eq("organization_id", organizationId).eq("id", o.client_id).maybeSingle(),
    db
      .from("work_items")
      .select("id, task_status, task_party, task_since")
      .eq("organization_id", organizationId)
      .eq("id", o.work_item_id)
      .maybeSingle(),
    db
      .from("opportunity_requirements")
      .select("id, label, required, position, supplied_at, supplied_by, evidence_document_id, evidence_email_message_id, evidence_note")
      .eq("organization_id", organizationId)
      .eq("opportunity_id", id)
      .order("position", { ascending: true }),
    db
      .from("opportunity_insurers")
      .select("id, insurer_id, added_at, removed_at, removed_reason")
      .eq("organization_id", organizationId)
      .eq("opportunity_id", id)
      .order("added_at", { ascending: true }),
    db.from("insurers").select("id, name").eq("organization_id", organizationId).order("name", { ascending: true }),
    db
      .from("documents")
      .select("id, filename, created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", o.client_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const approaches = (insQ.data ?? []) as {
    id: string;
    insurer_id: string;
    added_at: string;
    removed_at: string | null;
    removed_reason: string | null;
  }[];

  const [requestsQ, responsesQ] = await Promise.all([
    db
      .from("quote_requests")
      .select("id, opportunity_insurer_id, subject, body_text, prepared_at, prepared_by, approved_at, approved_by, sent_at, sent_email_message_id")
      .eq("organization_id", organizationId)
      .in("opportunity_insurer_id", approaches.map((a) => a.id)),
    db
      .from("insurer_responses")
      .select("id, opportunity_insurer_id, outcome, received_at, source_email_message_id, source_document_id, source_note, premium_amount, premium_currency, valid_until, decline_reason, recorded_by")
      .eq("organization_id", organizationId)
      .in("opportunity_insurer_id", approaches.map((a) => a.id)),
  ]);
  const requests = (requestsQ.data ?? []) as Record<string, string | null>[];
  const responses = (responsesQ.data ?? []) as Record<string, string | null>[];
  const deliveriesQ = requests.length
    ? await db
        .from("quote_request_deliveries")
        .select("quote_request_id, method, reference, delivered_at, recorded_by, evidence_document_id")
        .eq("organization_id", organizationId)
        .in("quote_request_id", requests.map((r) => r["id"] as string))
    : { data: [] };
  const deliveries = (deliveriesQ.data ?? []) as Record<string, string | null>[];

  const termsQ = await db
    .from("quote_terms")
    .select("id, insurer_response_id, term_type, label, extracted_value, corrected_value, corrected_by, corrected_at, amount, currency, unclear, evidence_document_id, evidence_page, position")
    .eq("organization_id", organizationId)
    .in("insurer_response_id", responses.map((r) => r["id"] as string))
    .order("position", { ascending: true });
  const terms = (termsQ.data ?? []) as Record<string, string | number | boolean | null>[];

  /* Every person named anywhere in this Space, looked up once. */
  const userIds = [
    o["owner_id"],
    ...((reqQ.data ?? []) as Record<string, string | null>[]).map((r) => r["supplied_by"]),
    ...requests.flatMap((r) => [r["prepared_by"], r["approved_by"]]),
    ...deliveries.map((d) => d["recorded_by"]),
    ...responses.map((r) => r["recorded_by"]),
    ...terms.map((t) => t["corrected_by"] as string | null),
  ].filter((x): x is string => typeof x === "string");
  const usersQ = userIds.length
    ? await db.from("users").select("id, display_name, full_name").in("id", [...new Set(userIds)])
    : { data: [] };
  const who = new Map<string, string | null>(
    ((usersQ.data ?? []) as { id: string; display_name: string | null; full_name: string | null }[]).map((u) => [
      u.id,
      u.display_name ?? u.full_name ?? null,
    ]),
  );
  const insurerName = new Map(
    ((allInsurersQ.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );

  const evidence = (
    documentId: string | null,
    emailMessageId: string | null,
    note: string | null,
  ): EvidenceRef | null => {
    if (documentId) {
      return { kind: "document", id: documentId, label: "The document it came from", path: `/documents/${documentId}` };
    }
    if (emailMessageId) {
      /* A message opens in its conversation: that is the Space that exists for it. */
      return { kind: "email", id: emailMessageId, label: "The email it came from", path: null };
    }
    if (note && note.trim() !== "") return { kind: "note", id: null, label: note, path: null };
    return null;
  };

  const view: Omit<OpportunityResponse, "next"> = {
    opportunity: {
      id: o.id,
      title: o["title"] as string,
      classOfBusiness: o["class_of_business"] as string,
      riskSummary: o["risk_summary"] ?? null,
      coverStart: o["cover_start"] ?? null,
      coverEnd: o["cover_end"] ?? null,
      ownerName: o["owner_id"] ? (who.get(o["owner_id"]) ?? null) : null,
      createdAt: o["created_at"] as string,
      closedAt: o["closed_at"] ?? null,
      closedOutcome: (o["closed_outcome"] ?? null) as OpportunityResponse["opportunity"]["closedOutcome"],
      closedReason: o["closed_reason"] ?? null,
      source: evidence(o["source_document_id"] ?? null, o["source_email_message_id"] ?? null, null),
    },
    client: {
      id: o.client_id,
      name: (clientQ.data as { name: string } | null)?.name ?? "",
    },
    workItem: {
      id: o.work_item_id,
      taskStatus: ((workQ.data as { task_status: string } | null)?.task_status ??
        "needs_you") as OpportunityResponse["workItem"]["taskStatus"],
      taskParty: (workQ.data as { task_party: string | null } | null)?.task_party ?? null,
      taskSince: (workQ.data as { task_since: string | null } | null)?.task_since ?? null,
    },
    requirements: ((reqQ.data ?? []) as Record<string, string | boolean | null>[]).map((r) => ({
      id: r["id"] as string,
      label: r["label"] as string,
      required: Boolean(r["required"]),
      suppliedAt: (r["supplied_at"] as string | null) ?? null,
      suppliedByName: r["supplied_by"] ? (who.get(r["supplied_by"] as string) ?? null) : null,
      evidence: evidence(
        (r["evidence_document_id"] as string | null) ?? null,
        (r["evidence_email_message_id"] as string | null) ?? null,
        (r["evidence_note"] as string | null) ?? null,
      ),
    })),
    insurers: approaches.map((a) => {
      const req = requests.find((r) => r["opportunity_insurer_id"] === a.id) ?? null;
      const res = responses.find((r) => r["opportunity_insurer_id"] === a.id) ?? null;
      return {
        id: a.id,
        insurerId: a.insurer_id,
        insurerName: insurerName.get(a.insurer_id) ?? "",
        addedAt: a.added_at,
        removedAt: a.removed_at,
        removedReason: a.removed_reason,
        request:
          req === null
            ? null
            : {
                id: req["id"] as string,
                subject: req["subject"] as string,
                body: req["body_text"] as string,
                preparedAt: req["prepared_at"] as string,
                preparedByName: req["prepared_by"] ? (who.get(req["prepared_by"]) ?? null) : null,
                approvedAt: req["approved_at"] ?? null,
                approvedByName: req["approved_by"] ? (who.get(req["approved_by"]) ?? null) : null,
                sentAt: req["sent_at"] ?? null,
                sentEmailMessageId: req["sent_email_message_id"] ?? null,
                delivery: (() => {
                  const d = deliveries.find((x) => x["quote_request_id"] === req["id"]);
                  return d
                    ? {
                        method: d["method"] as "own_email",
                        reference: d["reference"] as string,
                        deliveredAt: d["delivered_at"] as string,
                        recordedByName: d["recorded_by"] ? (who.get(d["recorded_by"]) ?? null) : null,
                        evidenceDocumentId: d["evidence_document_id"] ?? null,
                      }
                    : null;
                })(),
              },
        response:
          res === null
            ? null
            : {
                id: res["id"] as string,
                outcome: res["outcome"] as "quoted" | "declined" | "no_response",
                receivedAt: res["received_at"] ?? null,
                premiumAmount: pgMoney(res["premium_amount"]),
                premiumCurrency: res["premium_currency"] ?? null,
                validUntil: res["valid_until"] ?? null,
                declineReason: res["decline_reason"] ?? null,
                recordedByName: res["recorded_by"] ? (who.get(res["recorded_by"]) ?? null) : null,
                source: evidence(
                  res["source_document_id"] ?? null,
                  res["source_email_message_id"] ?? null,
                  res["source_note"] ?? null,
                ),
                terms: terms
                  .filter((t) => t["insurer_response_id"] === res["id"])
                  .map((t) => ({
                    id: t["id"] as string,
                    termType: t["term_type"] as QuoteTermType,
                    label: t["label"] as string,
                    extractedValue: (t["extracted_value"] as string | null) ?? null,
                    correctedValue: (t["corrected_value"] as string | null) ?? null,
                    correctedByName: t["corrected_by"] ? (who.get(t["corrected_by"] as string) ?? null) : null,
                    correctedAt: (t["corrected_at"] as string | null) ?? null,
                    amount: pgMoney(t["amount"]),
                    currency: (t["currency"] as string | null) ?? null,
                    unclear: Boolean(t["unclear"]),
                    evidence: evidence((t["evidence_document_id"] as string | null) ?? null, null, null),
                  })),
              },
      };
    }).map((i) => ({ ...i, ...insurerStage(i) })),
    availableInsurers: ((allInsurersQ.data ?? []) as { id: string; name: string }[]).map((i) => ({
      id: i.id,
      name: i.name,
    })),
    documents: ((docsQ.data ?? []) as { id: string; filename: string; created_at: string }[]).map((d) => ({
      id: d.id,
      filename: d.filename,
      createdAt: d.created_at,
    })),
    permissions: {
      canEdit: hasPermission(ctx, "space", "create"),
      canApprove: hasPermission(ctx, "email", "approve"),
      canRecordResponse: hasPermission(ctx, "space", "create"),
    },
    /*
     * Nothing in this deployment can send. Saying so here, once, is what keeps a Send button off
     * the screen and stops an approved request reading as one that went out.
     */
    sending: {
      available: false,
      reason:
        "Sending from ASAP is not connected yet. An approved request can be copied into the mailbox it should go from, and the delivery recorded here.",
    },
  };
  return { ...view, next: quotationNext(view) };
}

/** Writes the derived next action onto the quotation's work item, so every list reads the same. */
export async function syncQuotationWork(db: SupabaseClient, o: OpportunityResponse): Promise<void> {
  const { error } = await db.rpc("work_item_set_state", { p_work_item_id: o.workItem.id, ...workStateFrom(o.next) });
  // A failed sync leaves the previous state; it must not turn a recorded action into an error.
  if (error) return;
}

/** The words that do not tell one insurer from another. */
const INSURER_NOISE = /\b(insurance|assurance|company|co|ltd|limited|kenya|general|plc|group|the)\b|[.,&()]/gi;
const insurerKey = (name: string) => name.toLowerCase().replace(INSURER_NOISE, " ").replace(/\s+/g, " ").trim();

/**
 * A name a person typed, matched against the brokerage's insurers: exactly, then on the words that
 * identify it ("APA" is APA Insurance), then on a leading word. More than one match is said, not picked.
 */
export function matchInsurerName(
  name: string,
  onFile: { id: string; name: string }[],
): { outcome: "one"; id: string; name: string } | { outcome: "many"; names: string[] } | { outcome: "none" } {
  const exact = onFile.filter((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact.length === 1) return { outcome: "one", id: exact[0]!.id, name: exact[0]!.name };
  const key = insurerKey(name);
  if (!key) return { outcome: "none" };
  const same = onFile.filter((i) => insurerKey(i.name) === key);
  if (same.length === 1) return { outcome: "one", id: same[0]!.id, name: same[0]!.name };
  if (same.length > 1) return { outcome: "many", names: same.map((i) => i.name) };
  const starts = onFile.filter((i) => (" " + insurerKey(i.name) + " ").startsWith(" " + key + " "));
  if (starts.length === 1) return { outcome: "one", id: starts[0]!.id, name: starts[0]!.name };
  if (starts.length > 1) return { outcome: "many", names: starts.map((i) => i.name) };
  return { outcome: "none" };
}

/**
 * The request to one insurer, composed from the quotation's own records: the client, the cover
 * wanted, what the client has supplied (named as enclosed), and what is still to follow. It is a
 * draft — a person edits and approves it, then delivers it themselves.
 */
export function composeQuoteRequest(o: OpportunityResponse, insurerName: string): { subject: string; body: string } {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
  const supplied = o.requirements.filter((r) => r.suppliedAt);
  const outstanding = o.requirements.filter((r) => !r.suppliedAt);
  const op = o.opportunity;
  const period = op.coverStart ? `, from ${day(op.coverStart)}${op.coverEnd ? ` to ${day(op.coverEnd)}` : ""}` : "";
  const body = [
    `Dear ${insurerName} underwriting team,`,
    "",
    `We invite terms for ${op.classOfBusiness} cover for our client ${o.client.name}${period}.`,
    `Cover wanted: ${op.title}.`,
    ...(op.riskSummary ? ["", `The risk: ${op.riskSummary}`] : []),
    ...(supplied.length
      ? ["", "Enclosed:", ...supplied.map((r) => `- ${r.label}${r.evidence?.label ? ` (${r.evidence.label})` : ""}`)]
      : []),
    ...(outstanding.length
      ? ["", "To follow from the client (not yet supplied):", ...outstanding.map((r) => `- ${r.label}`)]
      : []),
    "",
    "Please reply with your premium, excess, key conditions and how long the terms are valid.",
  ].join("\n");
  return { subject: `Quotation request — ${o.client.name}, ${op.classOfBusiness}`, body };
}
