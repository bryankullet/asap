import {
  placementActionResponseSchema,
  placementActionSchema,
  placementResponseSchema,
  recordInstructionRequestSchema,
  recordInstructionResponseSchema,
  type ClientInstructionView,
  type EvidenceRef,
  type PlacementCoverStatus,
  type PlacementResponse,
  type QuoteTermType,
} from "@asap/schema";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { loadComparisonView, responseDigest } from "./comparisons.js";
import { parseBody } from "./_parse.js";

/**
 * Placement (4B-4).
 *
 * One refusal runs through every handler here: **no step is inferred from the step before it.**
 *
 *   recommendation      ≠ client decision        (an instruction needs evidence of how it came)
 *   client decision     ≠ approved request       (a person with the permission approves a digest)
 *   approved request    ≠ submitted request      (only evidence of transmission submits)
 *   submitted request   ≠ confirmed cover        (only the insurer's evidenced answer confirms)
 *   confirmed cover     ≠ issued policy          (4B-5, and a person)
 *
 * The database enforces each of those as a constraint or a trigger (0054). This file adds the
 * sentences: every refusal says what is missing and what would supply it, and names who may do
 * the thing when the caller may not.
 *
 * Sending is unavailable by design. Preparing makes a draft; approving makes an approved draft;
 * neither is "sent", and nothing here writes a submission without a person's evidence of sending.
 */

type Ctx = Awaited<ReturnType<typeof resolveContext>>;

const SENDING_REASON =
  "Sending from ASAP is not connected yet. Copy the approved request into the mailbox it should go from, then record that it was sent.";

const SOURCE_WORDS: Record<ClientInstructionView["source"], string> = {
  email: "By email",
  document: "In a document",
  telephone: "By telephone",
  meeting: "At a meeting",
  signed_acceptance: "By signed acceptance",
  in_person: "In person",
};

export function placementRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  /* ---- The client's instruction, which is what creates a placement ------------------------- */

  app.post("/opportunities/:id/instruction", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const opportunityId = c.req.param("id");
    const input = await parseBody(c, recordInstructionRequestSchema);

    const blocked = (reason: string) =>
      c.json(recordInstructionResponseSchema.parse({ outcome: "blocked", reason }));

    if (!hasPermission(ctx, "placement", "create")) {
      return blocked("You may not record a client's instruction.");
    }

    /* A click is not a decision. Where it came from is required, and it must be checkable. */
    if (
      input.evidenceEmailMessageId === undefined &&
      input.evidenceDocumentId === undefined &&
      (input.evidenceNote ?? "").trim().length < 10
    ) {
      return blocked(
        "Say how the client's instruction arrived: link the email, attach the document, or write down the call — who said it, when, and what they said.",
      );
    }
    if (
      (input.source === "email" && input.evidenceEmailMessageId === undefined && (input.evidenceNote ?? "").trim().length < 10) ||
      (input.source === "document" && input.evidenceDocumentId === undefined) ||
      (input.source === "signed_acceptance" && input.evidenceDocumentId === undefined)
    ) {
      return blocked(
        input.source === "email"
          ? "An instruction by email needs the email, or a note of what it said."
          : "An instruction in a document needs the document attached.",
      );
    }

    const oppQ = await db
      .from("opportunities")
      .select("id, client_id, title, class_of_business, closed_at")
      .eq("organization_id", org.id)
      .eq("id", opportunityId)
      .maybeSingle();
    const opp = oppQ.data as
      | { id: string; client_id: string; title: string; class_of_business: string; closed_at: string | null }
      | null;
    if (opp === null) throw new HttpError(404, "not_found", "No opportunity with that id");
    if (opp.closed_at !== null) {
      return blocked("This quotation work is closed. Nothing more is recorded against it.");
    }

    const responseQ = await db
      .from("insurer_responses")
      .select("id, opportunity_id, opportunity_insurer_id, outcome, premium_amount, premium_currency, valid_until")
      .eq("organization_id", org.id)
      .eq("id", input.insurerResponseId)
      .maybeSingle();
    const response = responseQ.data as
      | {
          id: string;
          opportunity_id: string;
          opportunity_insurer_id: string;
          outcome: string;
          premium_amount: string | null;
          premium_currency: string | null;
          valid_until: string | null;
        }
      | null;
    if (response === null || response.opportunity_id !== opportunityId) {
      return blocked("That quote is not part of this quotation work.");
    }
    if (response.outcome !== "quoted") {
      return blocked("The client cannot instruct a quote the insurer never gave.");
    }

    /*
     * The comparison the client was shown. It must be current, presentable and actually
     * presented — an instruction against a comparison that is out of date, or holds an expired
     * quote, or was never put in front of the client, is an instruction about nothing they saw.
     */
    const view = await loadComparisonView(db, ctx, org.id, opportunityId);
    const comparison = view.comparison;
    const inComparison =
      comparison !== null && comparison.columns.some((column) => column.responseId === response.id);

    if (input.outsideComparison === undefined) {
      if (comparison === null) {
        return blocked("No comparison has been made for this quotation work. Compare the quotes and put them to the client first.");
      }
      if (!comparison.presentable.can) {
        return blocked(
          `The comparison cannot be relied on: ${comparison.presentable.reason ?? "it is out of date."} Make it again and put it to the client before recording their instruction.`,
        );
      }
      if (comparison.presentedAt === null) {
        return blocked(
          "Record that this comparison went to the client first. An instruction is a response to something the client was shown.",
        );
      }
      if (!inComparison) {
        return blocked(
          "The client was not shown this quote. Record it as an exception — with the reason and the evidence — if they really chose it.",
        );
      }
    } else if (!hasPermission(ctx, "placement", "approve")) {
      /* The exception path is never the ordinary route, so it needs the approver's permission. */
      return blocked(
        `Only someone who may approve placements can record an instruction outside the comparison${await whoMayApproveSuffix(db, org.id)}.`,
      );
    }

    const revisionId = await latestRevision(db, org.id, "insurer_response_revisions", "insurer_response_id", response.id);
    if (revisionId === null) {
      return blocked("That quote has no recorded revision, so what the client accepted could not be frozen. Record the quote again.");
    }

    /* Retrying the same instruction is the same instruction. Changing it supersedes the old. */
    const liveQ = await db
      .from("client_instructions")
      .select("id, insurer_response_id, response_revision_id")
      .eq("organization_id", org.id)
      .eq("opportunity_id", opportunityId)
      .is("superseded_at", null)
      .maybeSingle();
    const live = liveQ.data as
      | { id: string; insurer_response_id: string; response_revision_id: string }
      | null;
    if (live !== null && live.response_revision_id === revisionId) {
      const existing = await db
        .from("placements")
        .select("id")
        .eq("organization_id", org.id)
        .eq("client_instruction_id", live.id)
        .maybeSingle();
      return c.json(
        recordInstructionResponseSchema.parse({
          outcome: "already",
          placementId: (existing.data as { id: string } | null)?.id ?? null,
        }),
      );
    }

    const now = new Date().toISOString();

    if (live !== null) {
      const reason =
        live.insurer_response_id === response.id
          ? "The client instructed again against revised terms from the same insurer."
          : "The client changed their choice of insurer.";
      const superseded = await db
        .from("client_instructions")
        .update({ superseded_at: now, superseded_reason: reason })
        .eq("organization_id", org.id)
        .eq("id", live.id)
        .is("superseded_at", null)
        .select("id")
        .maybeSingle();
      if (superseded.error) return sendError(c, mapDatabaseError(superseded.error));

      /* The placement that rested on it is abandoned, not deleted: its history stays readable. */
      await db
        .from("placements")
        .update({ abandoned_at: now, abandoned_reason: reason, updated_at: now })
        .eq("organization_id", org.id)
        .eq("client_instruction_id", live.id)
        .is("abandoned_at", null);
    }

    const insurerQ = await db
      .from("opportunity_insurers")
      .select("insurer_id")
      .eq("organization_id", org.id)
      .eq("id", response.opportunity_insurer_id)
      .maybeSingle();
    const insurerId = (insurerQ.data as { insurer_id: string } | null)?.insurer_id ?? null;
    if (insurerId === null) return blocked("That insurer is no longer part of this quotation work.");

    const instruction = await db
      .from("client_instructions")
      .insert({
        organization_id: org.id,
        opportunity_id: opportunityId,
        client_id: opp.client_id,
        comparison_id: comparison?.id ?? null,
        insurer_response_id: response.id,
        response_revision_id: revisionId,
        source: input.source,
        evidence_email_message_id: input.evidenceEmailMessageId ?? null,
        evidence_document_id: input.evidenceDocumentId ?? null,
        evidence_note: input.evidenceNote ?? null,
        client_conditions: input.clientConditions ?? null,
        instructed_at: input.instructedAt,
        recorded_by: user.id,
        outside_comparison: input.outsideComparison !== undefined,
        exception_reason: input.outsideComparison?.reason ?? null,
        exception_by: input.outsideComparison === undefined ? null : user.id,
      })
      .select("id")
      .maybeSingle();
    if (instruction.error || !instruction.data) {
      return blocked("The instruction could not be recorded. It may have been recorded a moment ago — refresh and look.");
    }
    const instructionId = (instruction.data as { id: string }).id;

    /* Work first: anything needing a person appears in Work, and a retry finds the same item. */
    const title = placementTitle(opp.title);
    const clientName = await nameOf(db, org.id, "clients", opp.client_id);
    const work = await db.rpc("work_item_create", {
      p_organization_id: org.id,
      p_kind: "placement",
      p_title: title,
      p_client_name: clientName ?? "the client",
      p_steps: [],
      p_task_status: "needs_you",
      p_task_party: null,
      p_client_id: opp.client_id,
      p_insurer_id: insurerId,
      p_class_of_business: opp.class_of_business,
    });
    const workItemId = (work.data as { id: string } | null)?.id ?? null;
    if (work.error || workItemId === null) {
      return blocked("The placement's work item could not be opened, so nothing was placed. Try again.");
    }

    const placement = await db
      .from("placements")
      .insert({
        organization_id: org.id,
        opportunity_id: opportunityId,
        client_id: opp.client_id,
        client_instruction_id: instructionId,
        insurer_id: insurerId,
        work_item_id: workItemId,
        requested_effective_at: input.requestedEffectiveAt,
        requested_expiry_at: input.requestedExpiryAt ?? null,
        created_by: user.id,
        basis_premium_amount: response.premium_amount,
        basis_premium_currency: response.premium_currency,
        basis_valid_until: response.valid_until,
        basis_sha256: responseDigest({
          outcome: response.outcome,
          premiumAmount: response.premium_amount,
          premiumCurrency: response.premium_currency,
          validUntil: response.valid_until,
        }),
      })
      .select("id")
      .maybeSingle();
    if (placement.error || !placement.data) {
      return blocked("The placement could not be opened. The instruction is recorded; try again to place it.");
    }
    const placementId = (placement.data as { id: string }).id;

    /* Freeze the terms: copied by revision, so a later correction cannot rewrite them. */
    const terms = await db
      .from("quote_terms")
      .select("id")
      .eq("organization_id", org.id)
      .eq("insurer_response_id", response.id);
    for (const t of (terms.data ?? []) as { id: string }[]) {
      const rev = await db
        .from("quote_term_revisions")
        .select("id, term_type, label, extracted_value, corrected_value, amount, currency, unclear, revision")
        .eq("organization_id", org.id)
        .eq("quote_term_id", t.id)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = rev.data as Record<string, unknown> | null;
      if (r === null) continue;
      await db.from("placement_basis_terms").insert({
        organization_id: org.id,
        placement_id: placementId,
        quote_term_revision_id: r["id"],
        term_type: r["term_type"],
        label: r["label"],
        value: (r["corrected_value"] as string | null) ?? (r["extracted_value"] as string | null),
        amount: r["amount"],
        currency: r["currency"],
        unclear: Boolean(r["unclear"]),
      });
    }

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: input.outsideComparison === undefined
        ? "placement.instruction_recorded"
        : "placement.instruction_recorded_outside_comparison",
      objectType: "placement",
      objectId: placementId,
      result: "success",
      /* Identities and the source. The client's own words stay in the business record. */
      newState: {
        opportunityId,
        insurerResponseId: response.id,
        responseRevisionId: revisionId,
        comparisonId: comparison?.id ?? null,
        source: input.source,
        superseded: live?.id ?? null,
      },
    });

    return c.json(recordInstructionResponseSchema.parse({ outcome: "done", placementId }));
  });

  /* ---- Reading one placement ---------------------------------------------------------------- */

  app.get("/placements/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(placementResponseSchema.parse(await load(db, ctx, org.id, c.req.param("id"))));
  });

  /* ---- Everything after the instruction ----------------------------------------------------- */

  app.post("/placements/:id/actions", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");
    const input = await parseBody(c, placementActionSchema);

    const blocked = (reason: string) =>
      c.json(placementActionResponseSchema.parse({ outcome: "blocked", reason }));
    const done = async (outcome: "done" | "already" = "done") =>
      c.json(
        placementActionResponseSchema.parse({ outcome, placement: await load(db, ctx, org.id, id) }),
      );

    const view = await load(db, ctx, org.id, id);
    const now = new Date().toISOString();

    if (view.instruction.supersededAt !== null) {
      return blocked(
        `The client's instruction behind this placement was superseded: ${view.instruction.supersededReason ?? "it changed."} Work from the current placement.`,
      );
    }

    switch (input.action) {
      case "prepare_request": {
        if (!hasPermission(ctx, "placement", "edit")) {
          return blocked("You may not prepare a placement request.");
        }
        if (view.drift.stale) {
          return blocked(
            `The quotation has changed since the client accepted it (${view.drift.changes.map((ch) => ch.label).join(", ")}). Review the change, and record the client's instruction again where it matters, before preparing a request.`,
          );
        }
        if (view.request?.submission) {
          return blocked("This request has already been sent. A changed request is a new placement conversation with the insurer, not an edit.");
        }
        if (view.request !== null && view.request.subject === input.subject && view.request.body === input.body
            && view.request.coverRequested === input.coverRequested
            && (view.request.outstandingConditions ?? "") === (input.outstandingConditions ?? "")) {
          return done("already");
        }

        /* The database numbers the version, supersedes the old one, and stales its approval. */
        const prepared = await db
          .from("placement_requests")
          .insert({
            organization_id: org.id,
            placement_id: id,
            version: 1,
            subject: input.subject,
            body_text: input.body,
            cover_requested: input.coverRequested,
            effective_at: view.placement.requestedEffectiveAt,
            outstanding_conditions: input.outstandingConditions ?? null,
            sha256: "0".repeat(64),
            prepared_by: user.id,
          })
          .select("id, version")
          .maybeSingle();
        if (prepared.error || !prepared.data) return sendError(c, mapDatabaseError(prepared.error!));

        await moveWork(db, view.workItem.id, "needs_you", null, null, "placement.request_prepared", {
          placementId: id,
          step: "approval_required",
        });

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: view.request === null ? "placement.request_prepared" : "placement.request_revised",
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: { placementRequestId: (prepared.data as { id: string }).id },
        });
        return done();
      }

      case "approve_request": {
        if (!hasPermission(ctx, "placement", "approve")) {
          /*
           * Refused, and not silently: the person is told who may approve, and the Work item
           * says approval is what it is waiting for. Nothing about the placement changes.
           */
          await moveWork(db, view.workItem.id, "needs_you", null, null, "placement.approval_requested", {
            placementId: id,
            step: "approval_required",
          });
          return blocked(
            `You may not approve placement requests${await whoMayApproveSuffix(db, org.id)}.`,
          );
        }
        if (view.request === null || view.request.id !== input.placementRequestId) {
          return blocked("That is not the current version of this request. Approve the one on screen.");
        }
        if (view.drift.stale) {
          return blocked("The quotation has changed since the client accepted it. Nothing can be approved until that is reviewed.");
        }
        if (view.request.approval !== null) return done("already");

        const approved = await db
          .from("placement_request_approvals")
          .insert({
            organization_id: org.id,
            placement_request_id: view.request.id,
            sha256: view.request.sha256,
            approved_by: user.id,
          })
          .select("id")
          .maybeSingle();
        /* A race with a second approver: the partial unique index refuses one; read what won. */
        if (approved.error || !approved.data) return done("already");

        await moveWork(db, view.workItem.id, "needs_you", null, null, "placement.request_approved", {
          placementId: id,
          step: "submission_proof_missing",
        });

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "placement.request_approved",
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: { placementRequestId: view.request.id, version: view.request.version, sha256: view.request.sha256 },
        });
        return done();
      }

      case "record_submission": {
        if (!hasPermission(ctx, "placement", "send_external")) {
          return blocked("You may not record that a placement request was sent.");
        }
        /* The same key again is the same submission. Read before anything else refuses it. */
        const prior = await db
          .from("placement_submissions")
          .select("id")
          .eq("organization_id", org.id)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (prior.data !== null) return done("already");

        if (view.request === null || view.request.id !== input.placementRequestId) {
          return blocked("That is not the current version of this request.");
        }
        if (view.request.submission !== null) return done("already");
        if (view.request.approval === null) {
          return blocked("This request has not been approved. A draft is not sent, and cannot be recorded as sent.");
        }
        if (view.drift.stale) {
          return blocked("The quotation has changed since the client accepted it. Nothing can be sent until that is reviewed.");
        }
        if (input.evidenceDocumentId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
          return blocked(
            "Say how you know it was sent: attach the sent message or a screenshot, or write down when, from where and to whom. \"Sent\" on its own is not evidence.",
          );
        }

        const submitted = await db
          .from("placement_submissions")
          .insert({
            organization_id: org.id,
            placement_request_id: view.request.id,
            sha256: view.request.sha256,
            method: input.method,
            recipient: input.recipient,
            sent_at: input.sentAt,
            evidence_document_id: input.evidenceDocumentId ?? null,
            evidence_note: input.evidenceNote ?? null,
            recorded_by: user.id,
            idempotency_key: input.idempotencyKey,
          })
          .select("id")
          .maybeSingle();
        if (submitted.error || !submitted.data) return done("already");

        /* Now the insurer holds it, and Work names them with the date. */
        await moveWork(db, view.workItem.id, "with_party", view.insurer.name, input.sentAt, "placement.submitted", {
          placementId: id,
        });

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "placement.submission_recorded",
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: { placementRequestId: view.request.id, method: input.method, sentAt: input.sentAt },
        });
        return done();
      }

      case "record_insurer_response": {
        if (!hasPermission(ctx, "placement", "edit")) {
          return blocked("You may not record what the insurer said.");
        }
        if (view.request?.submission == null) {
          return blocked("Nothing has been sent to the insurer for this placement yet, so there is nothing for them to have answered.");
        }
        const confirmed = input.outcome === "confirmed_as_requested" || input.outcome === "confirmed_with_changes";
        if (confirmed && input.effectiveAt === undefined) {
          return blocked("A confirmation must say when cover begins. Without that there is no cover, only a letter.");
        }
        if (
          confirmed &&
          input.evidenceDocumentId === undefined &&
          input.evidenceEmailMessageId === undefined &&
          (input.evidenceNote ?? "").trim().length < 10
        ) {
          return blocked("Attach the insurer's confirmation, link their email, or write down how they confirmed — a confirmation needs evidence.");
        }
        if (input.outcome === "confirmed_with_changes" && (input.changesNote ?? "").trim().length < 10) {
          return blocked("Say what the insurer changed. A confirmation on different terms is not a confirmation of what the client asked for.");
        }
        if (input.outcome === "more_information_required" && (input.informationRequired ?? "").trim().length < 5) {
          return blocked("Say what the insurer needs.");
        }
        if (input.outcome === "declined" && (input.declineReason ?? "").trim().length < 5) {
          return blocked("A decline has to say why.");
        }

        /* A later answer supersedes an earlier one; both stay on the record. */
        await db
          .from("placement_insurer_responses")
          .update({ superseded_at: now, superseded_reason: "A later answer from the insurer was recorded." })
          .eq("organization_id", org.id)
          .eq("placement_id", id)
          .is("superseded_at", null);

        const recorded = await db
          .from("placement_insurer_responses")
          .insert({
            organization_id: org.id,
            placement_id: id,
            outcome: input.outcome,
            received_at: input.receivedAt,
            effective_at: input.effectiveAt ?? null,
            expiry_at: input.expiryAt ?? null,
            insurer_reference: input.insurerReference ?? null,
            changes_note: input.changesNote ?? null,
            information_required: input.informationRequired ?? null,
            decline_reason: input.declineReason ?? null,
            evidence_document_id: input.evidenceDocumentId ?? null,
            evidence_email_message_id: input.evidenceEmailMessageId ?? null,
            evidence_note: input.evidenceNote ?? null,
            recorded_by: user.id,
          })
          .select("id")
          .maybeSingle();
        if (recorded.error || !recorded.data) return sendError(c, mapDatabaseError(recorded.error!));

        /*
         * Anything that needs a person lands in Work. A confirmation as requested leaves the
         * item with a person too — policy issuance is next — but that is prepared explicitly.
         */
        const step =
          input.outcome === "confirmed_as_requested"
            ? "policy_issuance_required"
            : input.outcome === "confirmed_with_changes"
              ? "insurer_changed_terms"
              : input.outcome === "more_information_required"
                ? "insurer_needs_information"
                : "insurer_declined";
        await moveWork(db, view.workItem.id, "needs_you", null, null, "placement.insurer_answered", {
          placementId: id,
          step,
        });

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: `placement.insurer_${input.outcome}`,
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: {
            outcome: input.outcome,
            effectiveAt: input.effectiveAt ?? null,
            expiryAt: input.expiryAt ?? null,
            insurerReference: input.insurerReference ?? null,
          },
        });
        return done();
      }

      case "record_cancellation": {
        if (!hasPermission(ctx, "placement", "edit")) {
          return blocked("You may not record a cancellation.");
        }
        if (view.cancellation !== null) return done("already");
        const confirmed =
          view.insurerResponse?.outcome === "confirmed_as_requested" ||
          view.insurerResponse?.outcome === "confirmed_with_changes";
        if (!confirmed) return blocked("There is no confirmed cover to cancel.");
        if (
          input.evidenceDocumentId === undefined &&
          input.evidenceEmailMessageId === undefined &&
          (input.evidenceNote ?? "").trim().length < 10
        ) {
          return blocked("A cancellation needs evidence: the insurer's notice, the client's request, or a note of how it was agreed.");
        }
        const cancelled = await db
          .from("placement_cancellations")
          .insert({
            organization_id: org.id,
            placement_id: id,
            cancelled_at: input.cancelledAt,
            reason: input.reason,
            evidence_document_id: input.evidenceDocumentId ?? null,
            evidence_email_message_id: input.evidenceEmailMessageId ?? null,
            evidence_note: input.evidenceNote ?? null,
            recorded_by: user.id,
          })
          .select("id")
          .maybeSingle();
        if (cancelled.error || !cancelled.data) return done("already");

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: "placement.cancelled",
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: { cancelledAt: input.cancelledAt },
        });
        return done();
      }

      case "prepare_issuance": {
        if (!hasPermission(ctx, "placement", "edit")) {
          return blocked("You may not prepare policy issuance.");
        }
        if (!view.issuance.ready) {
          return blocked(view.issuance.reason ?? "Cover is not confirmed, so there is no policy to issue yet.");
        }
        /*
         * The 4B-5 handoff is Work, and only Work. No policy is created here: issuing one is a
         * person's decision, against the insurer's own schedule, in the next stage. The engine
         * finds an open item with the same title, so a retry opens the same one.
         */
        const clientName = view.client.name;
        const work = await db.rpc("work_item_create", {
          p_organization_id: org.id,
          p_kind: "placement",
          p_title: `${view.placement.title} — policy issuance`,
          p_client_name: clientName,
          p_steps: [],
          p_task_status: "needs_you",
          p_task_party: null,
          p_client_id: view.client.id,
          p_insurer_id: view.insurer.id,
          p_class_of_business: view.opportunity.classOfBusiness,
        });
        const result = work.data as { id: string; reopened: boolean } | null;
        if (work.error || result === null) {
          return blocked("The issuance work item could not be opened. Try again.");
        }

        await recordAudit(db, deps.logger, c, {
          organizationId: org.id,
          actorUserId: user.id,
          action: result.reopened ? "placement.issuance_reopened" : "placement.issuance_prepared",
          objectType: "placement",
          objectId: id,
          result: "success",
          newState: { workItemId: result.id },
        });
        return done(result.reopened ? "already" : "done");
      }
    }
  });

  return app;
}

/* ---- Helpers --------------------------------------------------------------------------------- */

/** "Acme motor fleet quotation — 2027" becomes "Acme motor fleet placement — 2027". */
export function placementTitle(opportunityTitle: string): string {
  return /quotation/i.test(opportunityTitle)
    ? opportunityTitle.replace(/quotations?/i, "placement")
    : `${opportunityTitle} — placement`;
}

async function nameOf(db: SupabaseClient, organizationId: string, table: string, id: string): Promise<string | null> {
  const { data } = await db.from(table).select("name").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function latestRevision(
  db: SupabaseClient,
  organizationId: string,
  table: string,
  column: string,
  rowId: string,
): Promise<string | null> {
  const { data } = await db
    .from(table)
    .select("id, revision")
    .eq("organization_id", organizationId)
    .eq(column, rowId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Who in this brokerage may approve a placement, read from its roles rather than written here.
 * A person refused an approval is told who to ask; the answer is the brokerage's own.
 */
async function whoMayApproveSuffix(db: SupabaseClient, organizationId: string): Promise<string> {
  const roles = await approverRoles(db, organizationId);
  return roles.length === 0 ? "" : ` — ask someone who is a ${roles.join(" or ")}`;
}

async function approverRoles(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const rolesQ = await db.from("roles").select("id, name").eq("organization_id", organizationId);
  const roles = (rolesQ.data ?? []) as { id: string; name: string }[];
  if (roles.length === 0) return [];
  const grantsQ = await db
    .from("role_permissions")
    .select("role_id, permission:permissions ( object_type, verb )")
    .in("role_id", roles.map((r) => r.id));
  const approving = new Set(
    ((grantsQ.data ?? []) as unknown as {
      role_id: string;
      permission: { object_type: string; verb: string } | null;
    }[])
      .filter((g) => g.permission?.object_type === "placement" && g.permission.verb === "approve")
      .map((g) => g.role_id),
  );
  return roles.filter((r) => approving.has(r.id)).map((r) => r.name).sort();
}

/**
 * Move the Work item, through the engine, never directly: `work_items` is engine-owned and a
 * signed-in person has no write grant on it (0018, 0023). A version race is not fatal here —
 * the placement's own facts are already recorded, and the next action re-reads the item.
 */
async function moveWork(
  db: SupabaseClient,
  workItemId: string,
  taskStatus: "needs_you" | "with_party" | "in_progress" | "done",
  party: string | null,
  since: string | null,
  auditAction: string,
  auditState: Record<string, unknown>,
): Promise<void> {
  const { data } = await db
    .from("work_items")
    .select("id, version, steps, task_next_check, cover_status, money_status, exception, completed_at")
    .eq("id", workItemId)
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (row === null) return;
  await db.rpc("work_item_apply", {
    p_id: workItemId,
    p_expected_version: row["version"],
    p_steps: row["steps"] ?? [],
    p_task_status: taskStatus,
    p_task_party: party,
    p_task_since: taskStatus === "with_party" ? since : null,
    p_task_next_check: row["task_next_check"] ?? null,
    p_cover_status: row["cover_status"] ?? null,
    p_money_status: row["money_status"] ?? null,
    p_exception: row["exception"] ?? null,
    p_completed_at: row["completed_at"] ?? null,
    p_audit_action: auditAction,
    p_audit_new_state: auditState,
    p_cover_inception_at: null,
  });
}

/* ---- Reading it ------------------------------------------------------------------------------ */

async function load(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  id: string,
): Promise<PlacementResponse> {
  const placementQ = await db
    .from("placements")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (placementQ.error) throw mapDatabaseError(placementQ.error);
  if (!placementQ.data) throw new HttpError(404, "not_found", "No placement with that id");
  const p = placementQ.data as Record<string, unknown> & {
    id: string;
    opportunity_id: string;
    client_id: string;
    client_instruction_id: string;
    insurer_id: string;
    work_item_id: string;
    requested_effective_at: string;
    requested_expiry_at: string | null;
    created_at: string;
  };

  const [oppQ, clientQ, insurerQ, workQ, instructionsQ, basisQ, requestsQ, responsesQ, cancelQ] =
    await Promise.all([
      db.from("opportunities").select("id, title, class_of_business").eq("organization_id", organizationId).eq("id", p.opportunity_id).maybeSingle(),
      db.from("clients").select("id, name").eq("organization_id", organizationId).eq("id", p.client_id).maybeSingle(),
      db.from("insurers").select("id, name").eq("organization_id", organizationId).eq("id", p.insurer_id).maybeSingle(),
      db.from("work_items").select("id, task_status, task_party, task_since").eq("organization_id", organizationId).eq("id", p.work_item_id).maybeSingle(),
      db.from("client_instructions").select("*").eq("organization_id", organizationId).eq("opportunity_id", p.opportunity_id).order("recorded_at", { ascending: false }),
      db.from("placement_basis_terms").select("*").eq("organization_id", organizationId).eq("placement_id", id),
      db.from("placement_requests").select("*").eq("organization_id", organizationId).eq("placement_id", id).order("version", { ascending: false }),
      db.from("placement_insurer_responses").select("*").eq("organization_id", organizationId).eq("placement_id", id).is("superseded_at", null).maybeSingle(),
      db.from("placement_cancellations").select("*").eq("organization_id", organizationId).eq("placement_id", id).maybeSingle(),
    ]);

  const opp = oppQ.data as { id: string; title: string; class_of_business: string };
  const client = clientQ.data as { id: string; name: string };
  const insurer = (insurerQ.data as { id: string; name: string } | null) ?? { id: p.insurer_id, name: "The insurer" };
  const work = workQ.data as { id: string; task_status: PlacementResponse["workItem"]["taskStatus"]; task_party: string | null; task_since: string | null };
  const instructions = (instructionsQ.data ?? []) as Record<string, unknown>[];
  const requests = (requestsQ.data ?? []) as Record<string, unknown>[];

  const requestIds = requests.map((r) => r["id"] as string);
  const [approvalsQ, submissionsQ] = await Promise.all([
    requestIds.length === 0
      ? Promise.resolve({ data: [] })
      : db.from("placement_request_approvals").select("*").eq("organization_id", organizationId).in("placement_request_id", requestIds),
    requestIds.length === 0
      ? Promise.resolve({ data: [] })
      : db.from("placement_submissions").select("*").eq("organization_id", organizationId).in("placement_request_id", requestIds),
  ]);
  const approvals = (approvalsQ.data ?? []) as Record<string, unknown>[];
  const submissions = (submissionsQ.data ?? []) as Record<string, unknown>[];

  const people = await names(db, [
    ...instructions.map((i) => i["recorded_by"] as string),
    ...requests.map((r) => r["prepared_by"] as string),
    ...approvals.map((a) => a["approved_by"] as string),
    ...submissions.map((s) => s["recorded_by"] as string),
    (responsesQ.data as Record<string, unknown> | null)?.["recorded_by"] as string,
  ]);

  const comparisonVersions = await versionsOf(db, organizationId, instructions.map((i) => i["comparison_id"] as string | null));

  const toInstruction = (i: Record<string, unknown>): ClientInstructionView => ({
    id: i["id"] as string,
    source: i["source"] as ClientInstructionView["source"],
    evidence: evidence(i, `${SOURCE_WORDS[i["source"] as ClientInstructionView["source"]]}.`),
    clientConditions: (i["client_conditions"] as string | null) ?? null,
    instructedAt: i["instructed_at"] as string,
    recordedByName: people.get(i["recorded_by"] as string) ?? null,
    recordedAt: i["recorded_at"] as string,
    comparisonVersion: comparisonVersions.get((i["comparison_id"] as string | null) ?? "") ?? null,
    outsideComparison: Boolean(i["outside_comparison"]),
    exceptionReason: (i["exception_reason"] as string | null) ?? null,
    supersededAt: (i["superseded_at"] as string | null) ?? null,
    supersededReason: (i["superseded_reason"] as string | null) ?? null,
  });

  const instructionRow = instructions.find((i) => i["id"] === p.client_instruction_id);
  if (instructionRow === undefined) throw new HttpError(404, "not_found", "The placement's instruction is not readable");
  const instruction = toInstruction(instructionRow);

  const liveRequest = requests.find((r) => r["superseded_at"] === null) ?? null;
  const liveApproval = liveRequest === null
    ? null
    : (approvals.find((a) => a["placement_request_id"] === liveRequest["id"] && a["superseded_at"] === null) ?? null);
  const submission = liveRequest === null
    ? null
    : (submissions.find((s) => s["placement_request_id"] === liveRequest["id"]) ?? null);

  /*
   * Has the quotation moved since the client accepted it? The instruction names one revision;
   * if a newer one exists, what the client accepted is no longer the offer on file.
   */
  const drift = await driftOf(db, organizationId, instructionRow, p, (basisQ.data ?? []) as Record<string, unknown>[]);

  const response = responsesQ.data as Record<string, unknown> | null;
  const cancellation = cancelQ.data as Record<string, unknown> | null;

  const cover = coverOf(liveRequest, submission, response, cancellation, insurer.name);
  const title = placementTitle(opp.title);
  const confirmedAsRequested = response?.["outcome"] === "confirmed_as_requested";
  const issuanceWork = confirmedAsRequested
    ? await openWork(db, organizationId, `${title} — policy issuance`)
    : null;

  const approverList = await approverRoles(db, organizationId);

  return {
    placement: {
      id: p.id,
      title,
      requestedEffectiveAt: p.requested_effective_at,
      requestedExpiryAt: p.requested_expiry_at,
      createdAt: p.created_at,
    },
    client,
    opportunity: { id: opp.id, title: opp.title, classOfBusiness: opp.class_of_business },
    insurer,
    workItem: { id: work.id, taskStatus: work.task_status, taskParty: work.task_party, taskSince: work.task_since },
    instruction,
    instructionHistory: instructions.filter((i) => i["id"] !== instructionRow["id"]).map(toInstruction),
    basis: {
      premiumAmount: (p["basis_premium_amount"] as string | null) ?? null,
      premiumCurrency: (p["basis_premium_currency"] as string | null) ?? null,
      validUntil: (p["basis_valid_until"] as string | null) ?? null,
      terms: ((basisQ.data ?? []) as Record<string, unknown>[]).map((t) => ({
        termType: t["term_type"] as QuoteTermType,
        label: t["label"] as string,
        value: (t["value"] as string | null) ?? null,
        amount: (t["amount"] as string | null) ?? null,
        currency: (t["currency"] as string | null) ?? null,
        unclear: Boolean(t["unclear"]),
      })),
    },
    drift,
    request:
      liveRequest === null
        ? null
        : {
            id: liveRequest["id"] as string,
            version: liveRequest["version"] as number,
            subject: liveRequest["subject"] as string,
            body: liveRequest["body_text"] as string,
            coverRequested: liveRequest["cover_requested"] as string,
            effectiveAt: liveRequest["effective_at"] as string,
            outstandingConditions: (liveRequest["outstanding_conditions"] as string | null) ?? null,
            sha256: liveRequest["sha256"] as string,
            preparedByName: people.get(liveRequest["prepared_by"] as string) ?? null,
            preparedAt: liveRequest["prepared_at"] as string,
            approval:
              liveApproval === null
                ? null
                : {
                    approvedByName: people.get(liveApproval["approved_by"] as string) ?? null,
                    approvedAt: liveApproval["approved_at"] as string,
                  },
            submission:
              submission === null
                ? null
                : {
                    method: submission["method"] as NonNullable<PlacementResponse["request"]>["submission"] extends infer S
                      ? S extends { method: infer M } ? M : never
                      : never,
                    recipient: submission["recipient"] as string,
                    sentAt: submission["sent_at"] as string,
                    evidence: evidence(submission, "Recorded as sent by a person."),
                    recordedByName: people.get(submission["recorded_by"] as string) ?? null,
                  },
          },
    requestHistory: requests
      .filter((r) => r["id"] !== liveRequest?.["id"])
      .map((r) => ({
        version: r["version"] as number,
        preparedAt: r["prepared_at"] as string,
        approvedAt:
          (approvals.find((a) => a["placement_request_id"] === r["id"])?.["approved_at"] as string | undefined) ?? null,
        supersededAt: (r["superseded_at"] as string | null) ?? null,
        supersededReason: (r["superseded_reason"] as string | null) ?? null,
      })),
    insurerResponse:
      response === null
        ? null
        : {
            outcome: response["outcome"] as NonNullable<PlacementResponse["insurerResponse"]>["outcome"],
            receivedAt: response["received_at"] as string,
            effectiveAt: (response["effective_at"] as string | null) ?? null,
            expiryAt: (response["expiry_at"] as string | null) ?? null,
            insurerReference: (response["insurer_reference"] as string | null) ?? null,
            changesNote: (response["changes_note"] as string | null) ?? null,
            informationRequired: (response["information_required"] as string | null) ?? null,
            declineReason: (response["decline_reason"] as string | null) ?? null,
            evidence: evidence(response, "Recorded by a person."),
            recordedByName: people.get(response["recorded_by"] as string) ?? null,
          },
    cancellation:
      cancellation === null
        ? null
        : {
            cancelledAt: cancellation["cancelled_at"] as string,
            reason: cancellation["reason"] as string,
            evidence: evidence(cancellation, "Recorded by a person."),
          },
    cover,
    blockers: blockersOf({ instruction, liveRequest, liveApproval, submission, response, drift, insurerName: insurer.name, workSince: work.task_since }),
    nextAction: nextActionOf({ instruction, liveRequest, liveApproval, submission, response, drift, cancellation, issuanceWork }),
    permissions: {
      canRecordInstruction: hasPermission(ctx, "placement", "create"),
      canPrepare: hasPermission(ctx, "placement", "edit"),
      canApprove: hasPermission(ctx, "placement", "approve"),
      canRecordSubmission: hasPermission(ctx, "placement", "send_external"),
      canRecordResponse: hasPermission(ctx, "placement", "edit"),
      approverRoles: approverList,
    },
    sending: { available: false, reason: SENDING_REASON },
    issuance: {
      ready: confirmedAsRequested && cancellation === null,
      reason: cancellation !== null
        ? "This cover was cancelled."
        : response?.["outcome"] === "confirmed_with_changes"
          ? "The insurer confirmed on changed terms. The client must accept them, and the confirmation be recorded as requested, before a policy is issued."
          : confirmedAsRequested
            ? null
            : "Cover is not confirmed, so there is no policy to issue yet.",
      workItemId: issuanceWork,
    },
  };
}

function evidence(row: Record<string, unknown>, fallback: string): EvidenceRef {
  const documentId = (row["evidence_document_id"] as string | null) ?? null;
  if (documentId !== null) {
    return { kind: "document", id: documentId, label: "The attached document", path: `/documents/${documentId}` };
  }
  const emailId = ((row["evidence_email_message_id"] ?? row["provider_message_id"]) as string | null) ?? null;
  if (emailId !== null) {
    return { kind: "email", id: emailId, label: "The linked email", path: null };
  }
  const note = (row["evidence_note"] as string | null) ?? null;
  return { kind: "note", id: null, label: note ?? fallback, path: null };
}

async function names(db: SupabaseClient, ids: (string | undefined | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data } = await db.from("users").select("id, full_name").in("id", wanted);
  for (const r of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (r.full_name) out.set(r.id, r.full_name);
  }
  return out;
}

async function versionsOf(db: SupabaseClient, organizationId: string, ids: (string | null)[]): Promise<Map<string, number>> {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  const out = new Map<string, number>();
  if (wanted.length === 0) return out;
  const { data } = await db.from("quote_comparisons").select("id, version").eq("organization_id", organizationId).in("id", wanted);
  for (const r of (data ?? []) as { id: string; version: number | null }[]) out.set(r.id, r.version ?? 1);
  return out;
}

async function openWork(db: SupabaseClient, organizationId: string, title: string): Promise<string | null> {
  const { data } = await db
    .from("work_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("title", title)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * What moved since the client accepted. Compared revision to revision, so the answer is old →
 * new and names the term, rather than "something changed".
 */
async function driftOf(
  db: SupabaseClient,
  organizationId: string,
  instruction: Record<string, unknown>,
  placement: Record<string, unknown>,
  basis: Record<string, unknown>[],
): Promise<PlacementResponse["drift"]> {
  const responseId = instruction["insurer_response_id"] as string;
  const latest = await db
    .from("insurer_response_revisions")
    .select("id, premium_amount, premium_currency, valid_until, revision")
    .eq("organization_id", organizationId)
    .eq("insurer_response_id", responseId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  const now = latest.data as Record<string, unknown> | null;
  const changes: PlacementResponse["drift"]["changes"] = [];

  if (now !== null && now["id"] !== instruction["response_revision_id"]) {
    const money = (a: unknown, c: unknown) =>
      a === null || a === undefined ? null : `${String(c ?? "")} ${Number(a).toLocaleString("en-KE")}`.trim();
    const wasPremium = money(placement["basis_premium_amount"], placement["basis_premium_currency"]);
    const nowPremium = money(now["premium_amount"], now["premium_currency"]);
    if (wasPremium !== nowPremium) changes.push({ label: "Premium", was: wasPremium, now: nowPremium });
    if ((placement["basis_valid_until"] ?? null) !== (now["valid_until"] ?? null)) {
      changes.push({
        label: "Valid until",
        was: (placement["basis_valid_until"] as string | null) ?? null,
        now: (now["valid_until"] as string | null) ?? null,
      });
    }
  }

  /* The terms: each frozen revision against the newest revision of the same term. */
  for (const b of basis) {
    const frozen = await db
      .from("quote_term_revisions")
      .select("quote_term_id")
      .eq("organization_id", organizationId)
      .eq("id", b["quote_term_revision_id"] as string)
      .maybeSingle();
    const termId = (frozen.data as { quote_term_id: string | null } | null)?.quote_term_id ?? null;
    if (termId === null) {
      changes.push({ label: b["label"] as string, was: (b["value"] as string | null) ?? null, now: null });
      continue;
    }
    const newest = await db
      .from("quote_term_revisions")
      .select("id, extracted_value, corrected_value, revision")
      .eq("organization_id", organizationId)
      .eq("quote_term_id", termId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const n = newest.data as Record<string, unknown> | null;
    if (n !== null && n["id"] !== b["quote_term_revision_id"]) {
      changes.push({
        label: b["label"] as string,
        was: (b["value"] as string | null) ?? null,
        now: ((n["corrected_value"] as string | null) ?? (n["extracted_value"] as string | null)) ?? null,
      });
    }
  }

  return { stale: changes.length > 0 || (now !== null && now["id"] !== instruction["response_revision_id"]), changes };
}

/**
 * The cover-period line, derived. Nothing here is stored: each state is read from the evidence
 * that makes it true, and "Active cover" is a matter of the insurer's own effective date.
 */
export function coverOf(
  request: Record<string, unknown> | null,
  submission: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  cancellation: Record<string, unknown> | null,
  insurerName: string,
  now: Date = new Date(),
): PlacementResponse["cover"] {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  if (cancellation !== null) {
    return { state: "cancelled", line: `Cancelled from ${day(cancellation["cancelled_at"] as string)}.` };
  }

  const outcome = response?.["outcome"] as string | undefined;
  if (outcome === "confirmed_as_requested" || outcome === "confirmed_with_changes") {
    const effective = new Date(response!["effective_at"] as string);
    const expiry = response!["expiry_at"] === null ? null : new Date(response!["expiry_at"] as string);
    const changed = outcome === "confirmed_with_changes" ? " on changed terms" : "";
    let state: PlacementCoverStatus;
    let line: string;
    if (expiry !== null && expiry <= now) {
      state = "expired";
      line = `Cover ended ${day(expiry.toISOString())}.`;
    } else if (effective > now) {
      state = "confirmed";
      line = `${insurerName} confirmed cover${changed}, beginning ${day(effective.toISOString())}. It has not started yet.`;
    } else {
      state = "active";
      line = `Cover began ${day(effective.toISOString())}${changed}${expiry === null ? "" : `, until ${day(expiry.toISOString())}`}.`;
    }
    return { state, line };
  }

  if (outcome === "declined") {
    return { state: null, line: `${insurerName} declined. There is no cover.` };
  }
  if (submission !== null) {
    return {
      state: "submitted",
      line: `Sent to ${insurerName} on ${day(submission["sent_at"] as string)}. Not confirmed — there is no cover yet.`,
    };
  }
  if (request !== null) {
    return { state: "requested", line: "A request is prepared. It has not been sent, and there is no cover." };
  }
  return { state: null, line: "Nothing has been requested from the insurer yet." };
}

function blockersOf(v: {
  instruction: ClientInstructionView;
  liveRequest: Record<string, unknown> | null;
  liveApproval: Record<string, unknown> | null;
  submission: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  drift: PlacementResponse["drift"];
  insurerName: string;
  workSince: string | null;
}): string[] {
  const out: string[] = [];
  if (v.drift.stale) {
    out.push(
      `The quotation changed after the client accepted it: ${v.drift.changes.map((c) => c.label).join(", ") || "a new revision exists"}. Nothing can be sent until it is reviewed.`,
    );
  }
  if (v.liveRequest === null) out.push("No placement request has been prepared yet.");
  else if (v.liveApproval === null) out.push("The request is waiting for someone permitted to approve it.");
  else if (v.submission === null) out.push("The approved request has not been sent. Sending from ASAP is not connected; send it yourself and record how.");
  const outcome = v.response?.["outcome"];
  if (outcome === "more_information_required") {
    out.push(`${v.insurerName} needs more information: ${String(v.response!["information_required"])}`);
  }
  if (outcome === "confirmed_with_changes") {
    out.push(`${v.insurerName} confirmed on different terms: ${String(v.response!["changes_note"])} The client must accept them before a policy is issued.`);
  }
  if (outcome === "declined") out.push(`${v.insurerName} declined: ${String(v.response!["decline_reason"])}`);
  return out;
}

function nextActionOf(v: {
  instruction: ClientInstructionView;
  liveRequest: Record<string, unknown> | null;
  liveApproval: Record<string, unknown> | null;
  submission: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  drift: PlacementResponse["drift"];
  cancellation: Record<string, unknown> | null;
  issuanceWork: string | null;
}): string {
  if (v.cancellation !== null) return "Nothing further: this cover was cancelled.";
  if (v.drift.stale) return "Review what changed in the quotation, and record the client's instruction again if it matters.";
  if (v.liveRequest === null) return "Prepare the placement request.";
  if (v.liveApproval === null) return "Have the request approved by someone permitted to approve placements.";
  if (v.submission === null) return "Send the approved request to the insurer yourself, then record how it was sent.";
  const outcome = v.response?.["outcome"];
  if (outcome === undefined) return "Record the insurer's answer when it arrives.";
  if (outcome === "more_information_required") return "Supply what the insurer asked for.";
  if (outcome === "confirmed_with_changes") return "Put the changed terms to the client.";
  if (outcome === "declined") return "Return to the comparison and take the client's instruction on another quote.";
  return v.issuanceWork === null ? "Prepare policy issuance." : "Policy issuance is in Work.";
}
