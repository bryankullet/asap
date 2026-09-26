import { createHash } from "node:crypto";
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
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
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
export function quoteRequestDigest(subject: string, body: string): string {
  return createHash("sha256")
    .update(`${subject}\u001e${body}`, "utf8")
    .digest("hex");
}

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
      .select("id")
      .eq("organization_id", org.id)
      .eq("work_item_id", workItemId)
      .maybeSingle();
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));

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

    return c.json({ opportunityId, workItemId }, 201);
  });

  app.get("/opportunities/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(opportunityResponseSchema.parse(await load(db, ctx, org.id, c.req.param("id"))));
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

    return c.json(opportunityResponseSchema.parse(await load(db, ctx, org.id, id)));
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
          opportunity: await load(db, ctx, org.id, id),
        }),
      );
    const done = async (outcome: "done" | "already" = "done") =>
      c.json(
        opportunityActionResponseSchema.parse({
          outcome,
          reason: null,
          opportunity: await load(db, ctx, org.id, id),
        }),
      );

    /* Approving is its own permission; everything else is ordinary quotation work. */
    const needsApproval = input.action === "approve_request";
    if (needsApproval && !hasPermission(ctx, "email", "approve")) {
      return blocked("You may not approve messages going out of this brokerage.");
    }
    if (!needsApproval && !hasPermission(ctx, "space", "create")) {
      return blocked("You may not change this quotation work.");
    }
    if (closed && input.action !== "close") {
      return blocked("This quotation work is closed. Nothing more is recorded against it.");
    }

    const now = new Date().toISOString();

    switch (input.action) {
      case "add_insurer": {
        const insurer = await db
          .from("insurers")
          .select("id")
          .eq("organization_id", org.id)
          .eq("id", input.insurerId)
          .maybeSingle();
        if (!insurer.data) return blocked("That insurer is not in this brokerage.");

        const live = await db
          .from("opportunity_insurers")
          .select("id, removed_at")
          .eq("organization_id", org.id)
          .eq("opportunity_id", id)
          .eq("insurer_id", input.insurerId)
          .maybeSingle();
        const row = live.data as { id: string; removed_at: string | null } | null;
        /* Already approached: the unique index would refuse this, so it is read rather than raced. */
        if (row && row.removed_at === null) return done("already");

        const added = await db
          .from("opportunity_insurers")
          .insert({
            organization_id: org.id,
            opportunity_id: id,
            insurer_id: input.insurerId,
            added_by: user.id,
          })
          .select("id")
          .maybeSingle();
        if (added.error || !added.data) return done("already");

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "opportunity.insurer_added",
          objectType: "opportunity",
          objectId: id,
          result: "success",
          newState: { insurerId: input.insurerId },
        });
        return done();
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
        return done();
      }

      case "supply_requirement": {
        if (
          input.documentId === undefined &&
          input.emailMessageId === undefined &&
          (input.note ?? "").trim() === ""
        ) {
          return blocked("Say what proves this: a document, an email, or a note.");
        }
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
        const approach = await db
          .from("opportunity_insurers")
          .select("id, removed_at")
          .eq("organization_id", org.id)
          .eq("id", input.opportunityInsurerId)
          .maybeSingle();
        const row = approach.data as { id: string; removed_at: string | null } | null;
        if (!row) return blocked("That insurer is not part of this quotation work.");
        if (row.removed_at !== null) return blocked("That insurer is no longer being approached.");

        /*
         * Preparing again replaces the text and clears any approval: an approval covers one exact
         * body, and re-preparing is by definition a different one.
         */
        const existing = await db
          .from("quote_requests")
          .select("id")
          .eq("organization_id", org.id)
          .eq("opportunity_insurer_id", input.opportunityInsurerId)
          .maybeSingle();

        if (existing.data) {
          const updated = await db
            .from("quote_requests")
            .update({
              subject: input.subject,
              body_text: input.body,
              approved_body_sha256: null,
              approved_by: null,
              approved_at: null,
              updated_at: now,
            })
            .eq("organization_id", org.id)
            .eq("id", (existing.data as { id: string }).id)
            .select("id")
            .maybeSingle();
          if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        } else {
          const inserted = await db
            .from("quote_requests")
            .insert({
              organization_id: org.id,
              opportunity_id: id,
              opportunity_insurer_id: input.opportunityInsurerId,
              subject: input.subject,
              body_text: input.body,
              prepared_by: user.id,
            })
            .select("id")
            .maybeSingle();
          if (inserted.error || !inserted.data) return done("already");
        }

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
        const req = await db
          .from("quote_requests")
          .select("id, subject, body_text, approved_at")
          .eq("organization_id", org.id)
          .eq("id", input.quoteRequestId)
          .maybeSingle();
        const row = req.data as
          | { id: string; subject: string; body_text: string; approved_at: string | null }
          | null;
        if (!row) return blocked("That request is not part of this quotation work.");
        if (row.approved_at !== null) return done("already");

        const updated = await db
          .from("quote_requests")
          .update({
            approved_by: user.id,
            approved_at: now,
            /* The approval covers this exact text; editing it afterwards clears it. */
            approved_body_sha256: quoteRequestDigest(row.subject, row.body_text),
            updated_at: now,
          })
          .eq("organization_id", org.id)
          .eq("id", row.id)
          .select("id")
          .maybeSingle();
        if (updated.error) return sendError(c, mapDatabaseError(updated.error));

        /*
         * The standing approval, kept where superseding it leaves a trace. The digest only: a
         * quotation request quotes the client's own information, and this is an audit table.
         */
        await db.from("quote_request_approvals").insert({
          organization_id: org.id,
          quote_request_id: row.id,
          body_sha256: quoteRequestDigest(row.subject, row.body_text),
          approved_by: user.id,
          approved_at: now,
        });

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

      case "record_response": {
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

        if (existing.data) {
          const updated = await db
            .from("insurer_responses")
            .update(row)
            .eq("organization_id", org.id)
            .eq("id", (existing.data as { id: string }).id)
            .select("id")
            .maybeSingle();
          if (updated.error) return sendError(c, mapDatabaseError(updated.error));
        } else {
          const inserted = await db.from("insurer_responses").insert(row).select("id").maybeSingle();
          if (inserted.error || !inserted.data) return done("already");
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
            premiumAmount: row.premium_amount,
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

async function load(
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

  return {
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
              },
        response:
          res === null
            ? null
            : {
                id: res["id"] as string,
                outcome: res["outcome"] as "quoted" | "declined" | "no_response",
                receivedAt: res["received_at"] ?? null,
                premiumAmount: res["premium_amount"] ?? null,
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
                    amount: (t["amount"] as string | null) ?? null,
                    currency: (t["currency"] as string | null) ?? null,
                    unclear: Boolean(t["unclear"]),
                    evidence: evidence((t["evidence_document_id"] as string | null) ?? null, null, null),
                  })),
              },
      };
    }),
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
        "Sending from ASAP is not connected yet. An approved request can be copied into the mailbox it should go from.",
    },
  };
}
