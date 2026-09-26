import { createHash, randomUUID } from "node:crypto";
import {
  type ClientInstructionView,
  type EvidenceRef,
  type PlacementAction,
  type PlacementCoverStatus,
  type PlacementResponse,
  type PreparedActionView,
  type QuoteTermType,
  type RecordInstructionRequest,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry } from "../audit.js";
import { hasPermission, type resolveContext } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import { loadComparisonView, responseDigest } from "../routes/comparisons.js";
import { summarise, verifyCoverMatch, type BasisSide, type ConfirmationSide } from "./cover-match.js";
import {
  REASON_COPY,
  syncPlacementWork,
  openWorkFor,
  ensureWork,
  resolveWork,
  type OpenWork,
  type WorkContext,
  type WorkTarget,
} from "./work.js";

/**
 * Placement, as a service (4B-4, 4B-4A).
 *
 * One refusal runs through every function here: **no step is inferred from the step before it.**
 *
 *   recommendation      ≠ client decision        (an instruction needs evidence of how it came)
 *   client decision     ≠ approved request       (a person with the permission approves a digest)
 *   approved request    ≠ submitted request      (only evidence of transmission submits)
 *   submitted request   ≠ confirmed cover        (only the insurer's evidenced answer confirms)
 *   confirmed cover     ≠ what the client agreed (the cover check compares them, field by field)
 *   confirmed cover     ≠ issued policy          (4B-5, and a person)
 *
 * The screen's action route and a confirmed Ask action both call `executePlacementAction` — one
 * validated path, so a prepared action can never do something the screen could not.
 *
 * Insurance reality and client agreement are kept apart on purpose. An insurer can put cover in
 * force on changed terms before the client agrees to them; the cover line then says Active cover,
 * truthfully, and the cover check says the terms differ, and policy issuance waits.
 */

export type Ctx = Awaited<ReturnType<typeof resolveContext>>;

export type Env = {
  db: SupabaseClient;
  ctx: Ctx;
  organizationId: string;
  userId: string;
  audit: (entry: Omit<AuditEntry, "organizationId" | "actorUserId">) => Promise<void>;
};

export type Outcome = { outcome: "done" | "already" | "blocked"; reason: string | null };

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

const done = (outcome: "done" | "already" = "done"): Outcome => ({ outcome, reason: null });
const blocked = (reason: string): Outcome => ({ outcome: "blocked", reason });

/** "Acme motor fleet quotation — 2027" becomes "Acme motor fleet placement — 2027". */
export function placementTitle(opportunityTitle: string): string {
  return /quotation/i.test(opportunityTitle)
    ? opportunityTitle.replace(/quotations?/i, "placement")
    : `${opportunityTitle} — placement`;
}

/* =============================================================================================
 * The client's instruction, which is what creates a placement.
 * ============================================================================================= */

export async function executeRecordInstruction(
  env: Env,
  opportunityId: string,
  input: RecordInstructionRequest,
): Promise<Outcome & { placementId: string | null }> {
  const { db, ctx } = env;
  const org = env.organizationId;
  const refuse = (reason: string) => ({ ...blocked(reason), placementId: null });

  if (!hasPermission(ctx, "placement", "create")) return refuse("You may not record a client's instruction.");

  /* A click is not a decision. Where it came from is required, and it must be checkable. */
  if (
    input.evidenceEmailMessageId === undefined &&
    input.evidenceDocumentId === undefined &&
    (input.evidenceNote ?? "").trim().length < 10
  ) {
    return refuse(
      "Say how the client's instruction arrived: link the email, attach the document, or write down the call — who said it, when, and what they said.",
    );
  }
  if (
    (input.source === "email" && input.evidenceEmailMessageId === undefined && (input.evidenceNote ?? "").trim().length < 10) ||
    (input.source === "document" && input.evidenceDocumentId === undefined) ||
    (input.source === "signed_acceptance" && input.evidenceDocumentId === undefined)
  ) {
    return refuse(
      input.source === "email"
        ? "An instruction by email needs the email, or a note of what it said."
        : "An instruction in a document needs the document attached.",
    );
  }

  const oppQ = await db
    .from("opportunities")
    .select("id, client_id, title, class_of_business, risk_summary, closed_at")
    .eq("organization_id", org)
    .eq("id", opportunityId)
    .maybeSingle();
  const opp = oppQ.data as
    | { id: string; client_id: string; title: string; class_of_business: string; risk_summary: string | null; closed_at: string | null }
    | null;
  if (opp === null) throw new HttpError(404, "not_found", "No opportunity with that id");
  if (opp.closed_at !== null) return refuse("This quotation work is closed. Nothing more is recorded against it.");

  const responseQ = await db
    .from("insurer_responses")
    .select("id, opportunity_id, opportunity_insurer_id, outcome, premium_amount, premium_currency, valid_until")
    .eq("organization_id", org)
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
  if (response === null || response.opportunity_id !== opportunityId) return refuse("That quote is not part of this quotation work.");
  if (response.outcome !== "quoted") return refuse("The client cannot instruct a quote the insurer never gave.");

  /*
   * The comparison the client was shown must be current, presentable and actually presented — an
   * instruction against anything else is an instruction about nothing they saw.
   */
  const view = await loadComparisonView(db, ctx, org, opportunityId);
  const comparison = view.comparison;
  const inComparison = comparison !== null && comparison.columns.some((col) => col.responseId === response.id);

  if (input.outsideComparison === undefined) {
    if (comparison === null) {
      return refuse("No comparison has been made for this quotation work. Compare the quotes and put them to the client first.");
    }
    if (!comparison.presentable.can) {
      return refuse(
        `The comparison cannot be relied on: ${comparison.presentable.reason ?? "it is out of date."} Make it again and put it to the client before recording their instruction.`,
      );
    }
    if (comparison.presentedAt === null) {
      return refuse("Record that this comparison went to the client first. An instruction is a response to something the client was shown.");
    }
    if (!inComparison) {
      return refuse("The client was not shown this quote. Record it as an exception — with the reason and the evidence — if they really chose it.");
    }
  } else if (!hasPermission(ctx, "placement", "approve")) {
    return refuse(`Only someone who may approve placements can record an instruction outside the comparison${await whoMayApproveSuffix(db, org)}.`);
  }

  const revisionId = await latestRevision(db, org, "insurer_response_revisions", "insurer_response_id", response.id);
  if (revisionId === null) {
    return refuse("That quote has no recorded revision, so what the client accepted could not be frozen. Record the quote again.");
  }

  /* Retrying the same instruction is the same instruction. Changing it supersedes the old. */
  const liveQ = await db
    .from("client_instructions")
    .select("id, insurer_response_id, response_revision_id")
    .eq("organization_id", org)
    .eq("opportunity_id", opportunityId)
    .is("superseded_at", null)
    .maybeSingle();
  const live = liveQ.data as { id: string; insurer_response_id: string; response_revision_id: string } | null;
  if (live !== null && live.response_revision_id === revisionId) {
    const existing = await db
      .from("placements")
      .select("id")
      .eq("organization_id", org)
      .eq("client_instruction_id", live.id)
      .maybeSingle();
    return { ...done("already"), placementId: (existing.data as { id: string } | null)?.id ?? null };
  }

  const now = new Date().toISOString();
  if (live !== null) {
    const reason =
      live.insurer_response_id === response.id
        ? "The client instructed again against revised terms from the same insurer."
        : "The client changed their choice of insurer.";
    await db
      .from("client_instructions")
      .update({ superseded_at: now, superseded_reason: reason })
      .eq("organization_id", org)
      .eq("id", live.id)
      .is("superseded_at", null);
    /* The placement that rested on it is abandoned, not deleted, and its Work is completed. */
    const abandoned = await db
      .from("placements")
      .select("id")
      .eq("organization_id", org)
      .eq("client_instruction_id", live.id)
      .is("abandoned_at", null)
      .maybeSingle();
    await db
      .from("placements")
      .update({ abandoned_at: now, abandoned_reason: reason, updated_at: now })
      .eq("organization_id", org)
      .eq("client_instruction_id", live.id)
      .is("abandoned_at", null);
    const abandonedId = (abandoned.data as { id: string } | null)?.id ?? null;
    if (abandonedId !== null) {
      for (const open of await openWorkFor(db, org, abandonedId)) {
        await resolveWork(db, org, abandonedId, open.reason);
      }
    }
  }

  const insurerQ = await db
    .from("opportunity_insurers")
    .select("insurer_id")
    .eq("organization_id", org)
    .eq("id", response.opportunity_insurer_id)
    .maybeSingle();
  const insurerId = (insurerQ.data as { insurer_id: string } | null)?.insurer_id ?? null;
  if (insurerId === null) return refuse("That insurer is no longer part of this quotation work.");

  const instruction = await db
    .from("client_instructions")
    .insert({
      organization_id: org,
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
      recorded_by: env.userId,
      outside_comparison: input.outsideComparison !== undefined,
      exception_reason: input.outsideComparison?.reason ?? null,
      exception_by: input.outsideComparison === undefined ? null : env.userId,
    })
    .select("id")
    .maybeSingle();
  if (instruction.error || !instruction.data) {
    return refuse("The instruction could not be recorded. It may have been recorded a moment ago — refresh and look.");
  }
  const instructionId = (instruction.data as { id: string }).id;

  /*
   * `placements.work_item_id` is required, so the placement's id is chosen here and its first
   * lifecycle Work — prepare the request — is opened under that identity before the row exists.
   */
  const placementId = randomUUID();
  const title = placementTitle(opp.title);
  const firstWorkId = await ensureWork(
    db,
    { organizationId: org, placementId, placementTitle: title, clientId: opp.client_id, insurerId, classOfBusiness: opp.class_of_business },
    { reason: "prepare_request", status: "needs_you", party: null, since: now, owner: null },
  );
  if (firstWorkId === null) return refuse("The placement's work item could not be opened, so nothing was placed. Try again.");

  const placement = await db
    .from("placements")
    .insert({
      id: placementId,
      organization_id: org,
      opportunity_id: opportunityId,
      client_id: opp.client_id,
      client_instruction_id: instructionId,
      insurer_id: insurerId,
      work_item_id: firstWorkId,
      requested_effective_at: input.requestedEffectiveAt,
      requested_expiry_at: input.requestedExpiryAt ?? null,
      created_by: env.userId,
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
    return refuse("The placement could not be opened. The instruction is recorded; try again to place it.");
  }

  /* Version 1 of what the client accepted, and its terms, copied by revision. */
  const basis = await db
    .from("placement_basis_versions")
    .insert({
      organization_id: org,
      placement_id: placementId,
      version: 1,
      client_instruction_id: instructionId,
      insurer_id: insurerId,
      class_of_business: opp.class_of_business,
      subject: opp.risk_summary,
      effective_at: input.requestedEffectiveAt,
      expiry_at: input.requestedExpiryAt ?? null,
      premium_amount: response.premium_amount,
      premium_currency: response.premium_currency,
      premium_basis: null,
      client_conditions: input.clientConditions ?? null,
      origin: "instruction",
      created_by: env.userId,
    })
    .select("id")
    .maybeSingle();
  const basisVersionId = (basis.data as { id: string } | null)?.id ?? null;

  const terms = await db.from("quote_terms").select("id").eq("organization_id", org).eq("insurer_response_id", response.id);
  for (const t of (terms.data ?? []) as { id: string }[]) {
    const rev = await db
      .from("quote_term_revisions")
      .select("id, term_type, label, extracted_value, corrected_value, amount, currency, unclear, revision")
      .eq("organization_id", org)
      .eq("quote_term_id", t.id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = rev.data as Record<string, unknown> | null;
    if (r === null) continue;
    await db.from("placement_basis_terms").insert({
      organization_id: org,
      placement_id: placementId,
      basis_version_id: basisVersionId,
      quote_term_revision_id: r["id"],
      term_type: r["term_type"],
      label: r["label"],
      value: (r["corrected_value"] as string | null) ?? (r["extracted_value"] as string | null),
      amount: r["amount"],
      currency: r["currency"],
      unclear: Boolean(r["unclear"]),
    });
  }

  await env.audit({
    action: input.outsideComparison === undefined ? "placement.instruction_recorded" : "placement.instruction_recorded_outside_comparison",
    objectType: "placement",
    objectId: placementId,
    result: "success",
    newState: {
      opportunityId,
      insurerResponseId: response.id,
      responseRevisionId: revisionId,
      comparisonId: comparison?.id ?? null,
      source: input.source,
      superseded: live?.id ?? null,
    },
  });

  /* And the first lifecycle Work, keyed on the placement: prepare the request. */
  await load(env.db, env.ctx, org, placementId, { sync: true });
  return { ...done(), placementId };
}

/* =============================================================================================
 * Everything after the instruction.
 * ============================================================================================= */

export async function executePlacementAction(env: Env, placementId: string, input: PlacementAction): Promise<Outcome> {
  const { db, ctx } = env;
  const org = env.organizationId;
  const view = await load(db, ctx, org, placementId);
  const now = new Date().toISOString();
  const w = workContext(org, view);

  if (view.instruction.supersededAt !== null && input.action !== "record_client_acceptance") {
    return blocked(
      `The client's instruction behind this placement was superseded: ${view.instruction.supersededReason ?? "it changed."} Work from the current placement.`,
    );
  }

  const after = async (): Promise<void> => {
    await load(db, ctx, org, placementId, { sync: true });
  };

  switch (input.action) {
    case "prepare_request": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not prepare a placement request.");
      if (view.drift.stale) {
        await after();
        return blocked(
          `The quotation has changed since the client accepted it (${view.drift.changes.map((ch) => ch.label).join(", ")}). Review the change, and record the client's instruction again where it matters, before preparing a request.`,
        );
      }
      if (view.request?.submission) {
        return blocked("This request has already been sent. A changed request is a new placement conversation with the insurer, not an edit.");
      }
      if (
        view.request !== null &&
        view.request.subject === input.subject &&
        view.request.body === input.body &&
        view.request.coverRequested === input.coverRequested &&
        (view.request.outstandingConditions ?? "") === (input.outstandingConditions ?? "")
      ) {
        return done("already");
      }
      /* The database numbers the version, supersedes the old one, and stales its approval. */
      const prepared = await db
        .from("placement_requests")
        .insert({
          organization_id: org,
          placement_id: placementId,
          version: 1,
          subject: input.subject,
          body_text: input.body,
          cover_requested: input.coverRequested,
          effective_at: view.placement.requestedEffectiveAt,
          outstanding_conditions: input.outstandingConditions ?? null,
          sha256: "0".repeat(64),
          prepared_by: env.userId,
        })
        .select("id, version")
        .maybeSingle();
      if (prepared.error || !prepared.data) throw mapDatabaseError(prepared.error!);
      await env.audit({
        action: view.request === null ? "placement.request_prepared" : "placement.request_revised",
        objectType: "placement",
        objectId: placementId,
        result: "success",
        newState: { placementRequestId: (prepared.data as { id: string }).id },
      });
      await after();
      return done();
    }

    case "request_approval": {
      if (view.request === null) return blocked("There is no placement request to approve yet.");
      if (view.request.approval !== null) return done("already");
      const approvers = await approversOf(db, org);
      const approver = approvers.find((a) => a.userId === input.approverUserId);
      if (approver === undefined) {
        return blocked(
          `That person may not approve placements${approvers.length === 0 ? "." : ` — choose one of ${approvers.map((a) => a.name).join(", ")}.`}`,
        );
      }
      /* Puts the approval in front of them. It approves nothing. */
      await ensureWork(db, w, { reason: "approval_required", status: "needs_you", party: null, since: now, owner: approver.userId });
      await env.audit({
        action: "placement.approval_requested",
        objectType: "placement",
        objectId: placementId,
        result: "success",
        newState: { approverUserId: approver.userId, placementRequestId: view.request.id },
      });
      return done();
    }

    case "approve_request": {
      if (!hasPermission(ctx, "placement", "approve")) {
        /* Refused, and not silently: Work records that approval is what it waits for. */
        await ensureWork(db, w, { reason: "approval_required", status: "needs_you", party: null, since: now, owner: null });
        await env.audit({
          action: "placement.approval_refused",
          objectType: "placement",
          objectId: placementId,
          result: "denied",
          newState: { placementRequestId: input.placementRequestId },
        });
        return blocked(`You may not approve placement requests${await whoMayApproveSuffix(db, org)}.`);
      }
      if (view.request === null || view.request.id !== input.placementRequestId) {
        return blocked("That is not the current version of this request. Approve the one on screen.");
      }
      if (view.drift.stale) return blocked("The quotation has changed since the client accepted it. Nothing can be approved until that is reviewed.");
      if (view.request.approval !== null) return done("already");
      const approved = await db
        .from("placement_request_approvals")
        .insert({ organization_id: org, placement_request_id: view.request.id, sha256: view.request.sha256, approved_by: env.userId })
        .select("id")
        .maybeSingle();
      if (approved.error || !approved.data) return done("already");
      await env.audit({
        action: "placement.request_approved",
        objectType: "placement",
        objectId: placementId,
        result: "success",
        newState: { placementRequestId: view.request.id, version: view.request.version, sha256: view.request.sha256 },
      });
      await after();
      return done();
    }

    case "record_submission": {
      if (!hasPermission(ctx, "placement", "send_external")) return blocked("You may not record that a placement request was sent.");
      const prior = await db
        .from("placement_submissions")
        .select("id")
        .eq("organization_id", org)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (prior.data !== null) return done("already");
      if (view.request === null || view.request.id !== input.placementRequestId) return blocked("That is not the current version of this request.");
      if (view.request.submission !== null) return done("already");
      if (view.request.approval === null) return blocked("This request has not been approved. A draft is not sent, and cannot be recorded as sent.");
      if (view.drift.stale) return blocked("The quotation has changed since the client accepted it. Nothing can be sent until that is reviewed.");
      if (input.evidenceDocumentId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
        return blocked(
          "Say how you know it was sent: attach the sent message or a screenshot, or write down when, from where and to whom. \"Sent\" on its own is not evidence.",
        );
      }
      const submitted = await db
        .from("placement_submissions")
        .insert({
          organization_id: org,
          placement_request_id: view.request.id,
          sha256: view.request.sha256,
          method: input.method,
          recipient: input.recipient,
          sent_at: input.sentAt,
          evidence_document_id: input.evidenceDocumentId ?? null,
          evidence_note: input.evidenceNote ?? null,
          recorded_by: env.userId,
          idempotency_key: input.idempotencyKey,
        })
        .select("id")
        .maybeSingle();
      if (submitted.error || !submitted.data) return done("already");
      await env.audit({
        action: "placement.submission_recorded",
        objectType: "placement",
        objectId: placementId,
        result: "success",
        newState: { placementRequestId: view.request.id, method: input.method, sentAt: input.sentAt },
      });
      await after();
      return done();
    }

    case "record_insurer_response": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not record what the insurer said.");
      if (view.request?.submission == null) {
        return blocked("Nothing has been sent to the insurer for this placement yet, so there is nothing for them to have answered.");
      }
      const confirmed = input.outcome === "confirmed_as_requested" || input.outcome === "confirmed_with_changes";
      if (confirmed && input.effectiveAt === undefined) {
        return blocked("A confirmation must say when cover begins. Without that there is no cover, only a letter.");
      }
      if (confirmed && input.evidenceDocumentId === undefined && input.evidenceEmailMessageId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
        return blocked("Attach the insurer's confirmation, link their email, or write down how they confirmed — a confirmation needs evidence.");
      }
      if (input.outcome === "confirmed_with_changes" && (input.changesNote ?? "").trim().length < 10) {
        return blocked("Say what the insurer changed. A confirmation on different terms is not a confirmation of what the client asked for.");
      }
      if (input.outcome === "confirmed_with_changes" && (input.termChanges?.length ?? 0) === 0 &&
          input.confirmedPremiumAmount === undefined && input.effectiveAt === view.basis.effectiveAt) {
        return blocked("List what changed — each term, the premium or the dates — so it can be checked against what the client accepted.");
      }
      if (input.outcome === "more_information_required" && (input.informationRequired ?? "").trim().length < 5) return blocked("Say what the insurer needs.");
      if (input.outcome === "declined" && (input.declineReason ?? "").trim().length < 5) return blocked("A decline has to say why.");

      await db
        .from("placement_insurer_responses")
        .update({ superseded_at: now, superseded_reason: "A later answer from the insurer was recorded." })
        .eq("organization_id", org)
        .eq("placement_id", placementId)
        .is("superseded_at", null);

      /*
       * "As requested" is recorded as the insurer's confirmation of exactly what was requested:
       * the accepted basis, carried over. Anything the person says changed overrides it, term by
       * term, so the cover check compares like with like.
       */
      const b = view.basis;
      const recorded = await db
        .from("placement_insurer_responses")
        .insert({
          organization_id: org,
          placement_id: placementId,
          outcome: input.outcome,
          received_at: input.receivedAt,
          effective_at: input.effectiveAt ?? null,
          expiry_at: input.expiryAt ?? (confirmed ? b.expiryAt : null),
          insurer_reference: input.insurerReference ?? null,
          changes_note: input.changesNote ?? null,
          information_required: input.informationRequired ?? null,
          decline_reason: input.declineReason ?? null,
          evidence_document_id: input.evidenceDocumentId ?? null,
          evidence_email_message_id: input.evidenceEmailMessageId ?? null,
          evidence_note: input.evidenceNote ?? null,
          recorded_by: env.userId,
          confirmed_insurer_name: confirmed ? view.insurer.name : null,
          confirmed_class_of_business: confirmed ? (input.confirmedClassOfBusiness ?? b.classOfBusiness) : null,
          confirmed_subject: confirmed ? (input.confirmedSubject ?? b.subject) : null,
          confirmed_premium_amount: confirmed ? (input.confirmedPremiumAmount ?? b.premiumAmount) : null,
          confirmed_premium_currency: confirmed ? (input.confirmedPremiumCurrency ?? b.premiumCurrency) : null,
          confirmed_premium_basis: confirmed ? (input.confirmedPremiumBasis ?? b.premiumBasis) : null,
        })
        .select("id")
        .maybeSingle();
      if (recorded.error || !recorded.data) throw mapDatabaseError(recorded.error!);
      const responseId = (recorded.data as { id: string }).id;

      if (confirmed) {
        const byKey = new Map<string, (typeof b.terms)[number]>(b.terms.map((t) => [`${t.termType}|${t.label}`, { ...t }]));
        for (const change of input.termChanges ?? []) {
          const key = `${change.termType}|${change.label}`;
          if (change.value === null) byKey.delete(key);
          else byKey.set(key, { termType: change.termType, label: change.label, value: change.value, amount: null, currency: null, unclear: change.unclear ?? false });
        }
        for (const t of byKey.values()) {
          await db.from("placement_confirmation_terms").insert({
            organization_id: org,
            placement_insurer_response_id: responseId,
            term_type: t.termType,
            label: t.label,
            value: t.value,
            amount: t.amount,
            currency: t.currency,
            unclear: t.unclear,
          });
        }
        await runCoverMatch(env, placementId, null);
      }

      await env.audit({
        action: `placement.insurer_${input.outcome}`,
        objectType: "placement",
        objectId: placementId,
        result: "success",
        newState: { outcome: input.outcome, effectiveAt: input.effectiveAt ?? null, expiryAt: input.expiryAt ?? null, insurerReference: input.insurerReference ?? null },
      });
      await after();
      return done();
    }

    case "verify_cover_match": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not run the cover check.");
      if (view.insurerResponse === null || !view.insurerResponse.outcome.startsWith("confirmed")) {
        return blocked("There is no confirmation to check.");
      }
      if (view.coverMatch?.current) return done("already");
      await runCoverMatch(env, placementId, env.userId);
      await after();
      return done();
    }

    case "record_client_acceptance":
      return recordClientAcceptance(env, view, input);

    case "record_cancellation": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not record a cancellation.");
      if (view.cancellation !== null) return done("already");
      const isConfirmed = view.insurerResponse?.outcome === "confirmed_as_requested" || view.insurerResponse?.outcome === "confirmed_with_changes";
      if (!isConfirmed) return blocked("There is no confirmed cover to cancel.");
      if (input.evidenceDocumentId === undefined && input.evidenceEmailMessageId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
        return blocked("A cancellation needs evidence: the insurer's notice, the client's request, or a note of how it was agreed.");
      }
      const cancelled = await db
        .from("placement_cancellations")
        .insert({
          organization_id: org,
          placement_id: placementId,
          cancelled_at: input.cancelledAt,
          reason: input.reason,
          evidence_document_id: input.evidenceDocumentId ?? null,
          evidence_email_message_id: input.evidenceEmailMessageId ?? null,
          evidence_note: input.evidenceNote ?? null,
          recorded_by: env.userId,
        })
        .select("id")
        .maybeSingle();
      if (cancelled.error || !cancelled.data) return done("already");
      await env.audit({ action: "placement.cancelled", objectType: "placement", objectId: placementId, result: "success", newState: { cancelledAt: input.cancelledAt } });
      await after();
      return done();
    }

    case "prepare_issuance": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not prepare policy issuance.");
      if (view.readiness.state !== "ready") {
        return blocked(view.readiness.reasons.map((r) => r.message).join(" "));
      }
      /*
       * The 4B-5 handoff is Work, and only Work — keyed on this placement, so asking twice finds
       * the same item. No policy is created here.
       */
      if (view.readiness.workItemId !== null) return done("already");
      await ensureWork(db, w, { reason: "issue_policy", status: "needs_you", party: null, since: now, owner: null });
      await env.audit({ action: "placement.issuance_prepared", objectType: "placement", objectId: placementId, result: "success", newState: {} });
      return done();
    }
  }
}

/* =============================================================================================
 * The cover check.
 * ============================================================================================= */

/** Compare the live confirmation with the current accepted basis version, and store the result. */
async function runCoverMatch(env: Env, placementId: string, comparedBy: string | null): Promise<string | null> {
  const { db } = env;
  const org = env.organizationId;
  const basis = await currentBasis(db, org, placementId);
  const responseQ = await db
    .from("placement_insurer_responses")
    .select("*")
    .eq("organization_id", org)
    .eq("placement_id", placementId)
    .is("superseded_at", null)
    .maybeSingle();
  const response = responseQ.data as Record<string, unknown> | null;
  if (basis === null || response === null) return null;

  const termsQ = await db
    .from("placement_confirmation_terms")
    .select("term_type, label, value, amount, currency, unclear")
    .eq("organization_id", org)
    .eq("placement_insurer_response_id", response["id"] as string);
  const insurer = await nameOf(db, org, "insurers", basis.insurerId);

  const basisSide: BasisSide = {
    insurerName: insurer ?? "The insurer",
    classOfBusiness: basis.classOfBusiness,
    subject: basis.subject,
    effectiveAt: basis.effectiveAt,
    expiryAt: basis.expiryAt,
    premiumAmount: basis.premiumAmount,
    premiumCurrency: basis.premiumCurrency,
    premiumBasis: basis.premiumBasis,
    clientConditions: basis.clientConditions,
    outstandingRequirements: null,
    terms: basis.terms,
  };
  const confirmationSide: ConfirmationSide = {
    insurerName: (response["confirmed_insurer_name"] as string | null) ?? null,
    classOfBusiness: (response["confirmed_class_of_business"] as string | null) ?? null,
    subject: (response["confirmed_subject"] as string | null) ?? null,
    effectiveAt: (response["effective_at"] as string | null) ?? null,
    expiryAt: (response["expiry_at"] as string | null) ?? null,
    premiumAmount: (response["confirmed_premium_amount"] as string | null) ?? null,
    premiumCurrency: (response["confirmed_premium_currency"] as string | null) ?? null,
    premiumBasis: (response["confirmed_premium_basis"] as string | null) ?? null,
    terms: ((termsQ.data ?? []) as Record<string, unknown>[]).map((t) => ({
      termType: t["term_type"] as string,
      label: t["label"] as string,
      value: (t["value"] as string | null) ?? null,
      amount: (t["amount"] as string | null) ?? null,
      currency: (t["currency"] as string | null) ?? null,
      unclear: Boolean(t["unclear"]),
    })),
  };

  const items = verifyCoverMatch(basisSide, confirmationSide);
  const totals = summarise(items);
  const result = await db
    .from("cover_match_results")
    .insert({
      organization_id: org,
      placement_id: placementId,
      basis_version_id: basis.id,
      placement_insurer_response_id: response["id"],
      compared_by: comparedBy,
      material_differences: totals.material,
      unclear_count: totals.unclear,
    })
    .select("id")
    .maybeSingle();
  const resultId = (result.data as { id: string } | null)?.id ?? null;
  if (resultId === null) return null;
  for (const [position, item] of items.entries()) {
    await db.from("cover_match_items").insert({
      organization_id: org,
      cover_match_result_id: resultId,
      field: item.field,
      term_type: item.termType,
      label: item.label,
      accepted_value: item.acceptedValue,
      confirmed_value: item.confirmedValue,
      classification: item.classification,
      material: item.material,
      position,
    });
  }
  await env.audit({
    action: "placement.cover_checked",
    objectType: "placement",
    objectId: placementId,
    result: "success",
    newState: { coverMatchId: resultId, basisVersionId: basis.id, materialDifferences: totals.material },
  });
  return resultId;
}

/* =============================================================================================
 * The client's answer to the insurer's changes.
 * ============================================================================================= */

async function recordClientAcceptance(
  env: Env,
  view: PlacementResponse,
  input: Extract<PlacementAction, { action: "record_client_acceptance" }>,
): Promise<Outcome> {
  const { db, ctx } = env;
  const org = env.organizationId;
  const placementId = view.placement.id;

  if (!hasPermission(ctx, "placement", "create")) return blocked("You may not record a client's decision.");
  const match = view.coverMatch;
  if (match === null || match.id !== input.coverMatchId) return blocked("That is not the current cover check. Decide against the one on screen.");
  if (!match.current) return blocked(`That cover check is out of date: ${match.staleReason ?? "an input moved."} Run it again first.`);
  if (match.materialDifferences === 0) return blocked("There is nothing to accept: the confirmation matches what the client agreed.");
  if (view.changeAcceptance !== null) return done("already");

  if (input.evidenceEmailMessageId === undefined && input.evidenceDocumentId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
    return blocked("Say how the client's decision arrived: link the email, attach the document, or write down who said what and when.");
  }

  const material = match.items.filter((i) => i.material);
  let decisions: { coverMatchItemId: string; decision: "accepted" | "rejected" | "clarify" }[];
  if (input.decision === "accept_all") {
    decisions = material.map((i) => ({ coverMatchItemId: i.id, decision: "accepted" as const }));
  } else if (input.decision === "reject") {
    decisions = material.map((i) => ({ coverMatchItemId: i.id, decision: "rejected" as const }));
  } else {
    /* Partial: every material difference must be decided, and at least one must not be accepted. */
    const given = new Map((input.items ?? []).map((i) => [i.coverMatchItemId, i.decision] as const));
    const undecided = material.filter((i) => !given.has(i.id));
    if (undecided.length > 0) return blocked(`Say what the client decided on each difference. Still undecided: ${undecided.map((i) => i.label).join(", ")}.`);
    decisions = material.map((i) => ({ coverMatchItemId: i.id, decision: given.get(i.id)! }));
    if (decisions.every((d) => d.decision === "accepted")) {
      return blocked("Every difference is marked accepted — record that as accepting all the changes, not as partial.");
    }
  }

  const now = new Date().toISOString();
  let newInstructionId: string | null = null;
  let newBasisId: string | null = null;

  if (input.decision === "accept_all") {
    /*
     * A new instruction revision, preserving the original: the client has now agreed to the
     * insurer's terms, and that agreement is its own record with its own evidence.
     */
    const old = view.instruction;
    await db
      .from("client_instructions")
      .update({ superseded_at: now, superseded_reason: "The client accepted the insurer's changed terms." })
      .eq("organization_id", org)
      .eq("id", old.id)
      .is("superseded_at", null);
    const oldRow = (await db.from("client_instructions").select("*").eq("organization_id", org).eq("id", old.id).maybeSingle()).data as Record<string, unknown>;
    const created = await db
      .from("client_instructions")
      .insert({
        organization_id: org,
        opportunity_id: view.opportunity.id,
        client_id: view.client.id,
        comparison_id: oldRow["comparison_id"] ?? null,
        insurer_response_id: oldRow["insurer_response_id"],
        response_revision_id: oldRow["response_revision_id"],
        source: input.source,
        evidence_email_message_id: input.evidenceEmailMessageId ?? null,
        evidence_document_id: input.evidenceDocumentId ?? null,
        evidence_note: input.evidenceNote ?? null,
        client_conditions: oldRow["client_conditions"] ?? null,
        instructed_at: input.decidedAt,
        recorded_by: env.userId,
        outside_comparison: Boolean(oldRow["outside_comparison"]),
        exception_reason: oldRow["exception_reason"] ?? null,
        exception_by: oldRow["exception_by"] ?? null,
        revises_instruction_id: old.id,
      })
      .select("id")
      .maybeSingle();
    newInstructionId = (created.data as { id: string } | null)?.id ?? null;
    if (newInstructionId === null) return blocked("The client's acceptance could not be recorded. Try again.");
    await db.from("placements").update({ client_instruction_id: newInstructionId, updated_at: now }).eq("organization_id", org).eq("id", placementId);

    /* A new accepted basis version: the insurer's confirmed terms, now agreed. Never an overwrite. */
    const r = view.insurerResponse!;
    const basis = await db
      .from("placement_basis_versions")
      .insert({
        organization_id: org,
        placement_id: placementId,
        version: view.basis.version + 1,
        client_instruction_id: newInstructionId,
        insurer_id: view.insurer.id,
        class_of_business: r.confirmedClassOfBusiness ?? view.basis.classOfBusiness,
        subject: r.confirmedSubject ?? view.basis.subject,
        effective_at: r.effectiveAt,
        expiry_at: r.expiryAt,
        premium_amount: r.confirmedPremiumAmount,
        premium_currency: r.confirmedPremiumCurrency,
        premium_basis: r.confirmedPremiumBasis,
        client_conditions: view.basis.clientConditions,
        origin: "client_accepted_changes",
        created_by: env.userId,
      })
      .select("id")
      .maybeSingle();
    newBasisId = (basis.data as { id: string } | null)?.id ?? null;
    for (const t of r.terms) {
      await db.from("placement_basis_terms").insert({
        organization_id: org,
        placement_id: placementId,
        basis_version_id: newBasisId,
        quote_term_revision_id: null,
        term_type: t.termType,
        label: t.label,
        value: t.value,
        amount: t.amount,
        currency: t.currency,
        unclear: t.unclear,
      });
    }
  }

  const acceptance = await db
    .from("client_change_acceptances")
    .insert({
      organization_id: org,
      placement_id: placementId,
      client_id: view.client.id,
      placement_insurer_response_id: view.insurerResponse!.id,
      cover_match_result_id: match.id,
      decision: input.decision,
      source: input.source,
      evidence_email_message_id: input.evidenceEmailMessageId ?? null,
      evidence_document_id: input.evidenceDocumentId ?? null,
      evidence_note: input.evidenceNote ?? null,
      decided_at: input.decidedAt,
      new_client_instruction_id: newInstructionId,
      new_basis_version_id: newBasisId,
      recorded_by: env.userId,
    })
    .select("id")
    .maybeSingle();
  const acceptanceId = (acceptance.data as { id: string } | null)?.id ?? null;
  if (acceptanceId === null) return done("already");
  for (const d of decisions) {
    await db.from("client_change_acceptance_items").insert({
      organization_id: org,
      client_change_acceptance_id: acceptanceId,
      cover_match_item_id: d.coverMatchItemId,
      decision: d.decision,
    });
  }

  /* A full acceptance changed what was agreed, so the cover is checked again against it. */
  if (input.decision === "accept_all") await runCoverMatch(env, placementId, null);

  await env.audit({
    action: `placement.client_${input.decision === "accept_all" ? "accepted_changes" : input.decision === "reject" ? "rejected_changes" : "partly_accepted_changes"}`,
    objectType: "placement",
    objectId: placementId,
    result: "success",
    newState: { coverMatchId: match.id, decision: input.decision, newInstructionId, newBasisVersionId: newBasisId },
  });
  await load(db, ctx, org, placementId, { sync: true });
  return done();
}

/* =============================================================================================
 * Reading one placement.
 * ============================================================================================= */

type Basis = {
  id: string;
  version: number;
  origin: "instruction" | "client_accepted_changes";
  insurerId: string;
  classOfBusiness: string | null;
  subject: string | null;
  effectiveAt: string | null;
  expiryAt: string | null;
  premiumAmount: string | null;
  premiumCurrency: string | null;
  premiumBasis: string | null;
  clientConditions: string | null;
  terms: { termType: QuoteTermType; label: string; value: string | null; amount: string | null; currency: string | null; unclear: boolean }[];
};

async function currentBasis(db: SupabaseClient, org: string, placementId: string): Promise<Basis | null> {
  const { data } = await db
    .from("placement_basis_versions")
    .select("*")
    .eq("organization_id", org)
    .eq("placement_id", placementId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = data as Record<string, unknown> | null;
  if (v === null) return null;
  const terms = await db
    .from("placement_basis_terms")
    .select("term_type, label, value, amount, currency, unclear")
    .eq("organization_id", org)
    .eq("basis_version_id", v["id"] as string);
  return {
    id: v["id"] as string,
    version: v["version"] as number,
    origin: v["origin"] as Basis["origin"],
    insurerId: v["insurer_id"] as string,
    classOfBusiness: (v["class_of_business"] as string | null) ?? null,
    subject: (v["subject"] as string | null) ?? null,
    effectiveAt: (v["effective_at"] as string | null) ?? null,
    expiryAt: (v["expiry_at"] as string | null) ?? null,
    premiumAmount: (v["premium_amount"] as string | null) ?? null,
    premiumCurrency: (v["premium_currency"] as string | null) ?? null,
    premiumBasis: (v["premium_basis"] as string | null) ?? null,
    clientConditions: (v["client_conditions"] as string | null) ?? null,
    terms: ((terms.data ?? []) as Record<string, unknown>[]).map((t) => ({
      termType: t["term_type"] as QuoteTermType,
      label: t["label"] as string,
      value: (t["value"] as string | null) ?? null,
      amount: (t["amount"] as string | null) ?? null,
      currency: (t["currency"] as string | null) ?? null,
      unclear: Boolean(t["unclear"]),
    })),
  };
}

export function workContext(org: string, view: PlacementResponse): WorkContext {
  return {
    organizationId: org,
    placementId: view.placement.id,
    placementTitle: view.placement.title,
    clientId: view.client.id,
    insurerId: view.insurer.id,
    classOfBusiness: view.opportunity.classOfBusiness,
  };
}

export async function load(
  db: SupabaseClient,
  ctx: Ctx,
  org: string,
  id: string,
  options: { sync?: boolean } = {},
): Promise<PlacementResponse> {
  const placementQ = await db.from("placements").select("*").eq("organization_id", org).eq("id", id).maybeSingle();
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
    abandoned_at: string | null;
  };

  const [oppQ, clientQ, insurerQ, workQ, instructionsQ, requestsQ, responsesQ, cancelQ] = await Promise.all([
    db.from("opportunities").select("id, title, class_of_business").eq("organization_id", org).eq("id", p.opportunity_id).maybeSingle(),
    db.from("clients").select("id, name").eq("organization_id", org).eq("id", p.client_id).maybeSingle(),
    db.from("insurers").select("id, name").eq("organization_id", org).eq("id", p.insurer_id).maybeSingle(),
    db.from("work_items").select("id, task_status, task_party, task_since").eq("organization_id", org).eq("id", p.work_item_id).maybeSingle(),
    db.from("client_instructions").select("*").eq("organization_id", org).eq("opportunity_id", p.opportunity_id).order("recorded_at", { ascending: false }),
    db.from("placement_requests").select("*").eq("organization_id", org).eq("placement_id", id).order("version", { ascending: false }),
    db.from("placement_insurer_responses").select("*").eq("organization_id", org).eq("placement_id", id).is("superseded_at", null).maybeSingle(),
    db.from("placement_cancellations").select("*").eq("organization_id", org).eq("placement_id", id).maybeSingle(),
  ]);

  const opp = oppQ.data as { id: string; title: string; class_of_business: string };
  const client = clientQ.data as { id: string; name: string };
  const insurer = (insurerQ.data as { id: string; name: string } | null) ?? { id: p.insurer_id, name: "The insurer" };
  const homeWork = (workQ.data as { id: string; task_status: PlacementResponse["workItem"]["taskStatus"]; task_party: string | null; task_since: string | null } | null) ?? {
    id: p.work_item_id,
    task_status: "needs_you" as const,
    task_party: null,
    task_since: null,
  };
  const instructions = (instructionsQ.data ?? []) as Record<string, unknown>[];
  const requests = (requestsQ.data ?? []) as Record<string, unknown>[];
  const response = responsesQ.data as Record<string, unknown> | null;
  const cancellation = cancelQ.data as Record<string, unknown> | null;

  const requestIds = requests.map((r) => r["id"] as string);
  const [approvalsQ, submissionsQ] = await Promise.all([
    requestIds.length === 0 ? Promise.resolve({ data: [] }) : db.from("placement_request_approvals").select("*").eq("organization_id", org).in("placement_request_id", requestIds),
    requestIds.length === 0 ? Promise.resolve({ data: [] }) : db.from("placement_submissions").select("*").eq("organization_id", org).in("placement_request_id", requestIds),
  ]);
  const approvals = (approvalsQ.data ?? []) as Record<string, unknown>[];
  const submissions = (submissionsQ.data ?? []) as Record<string, unknown>[];

  const basis = (await currentBasis(db, org, id)) ?? legacyBasis(p);
  const confirmationTerms = response === null
    ? []
    : (((await db.from("placement_confirmation_terms").select("*").eq("organization_id", org).eq("placement_insurer_response_id", response["id"] as string)).data ?? []) as Record<string, unknown>[]);

  /* The latest cover check, current only if it compared this basis version with this answer. */
  /*
   * The check that compared *these* inputs, if one exists; otherwise the most recent, shown stale.
   * Chosen by identity, not by timestamp: two checks written in one transaction share `now()`.
   */
  const matchesQ = await db
    .from("cover_match_results")
    .select("*")
    .eq("organization_id", org)
    .eq("placement_id", id)
    .order("compared_at", { ascending: false });
  const matches = (matchesQ.data ?? []) as Record<string, unknown>[];
  const match =
    matches.find((m) => m["basis_version_id"] === basis.id && response !== null && m["placement_insurer_response_id"] === response["id"]) ??
    matches[0] ??
    null;
  const matchItems = match === null
    ? []
    : (((await db.from("cover_match_items").select("*").eq("organization_id", org).eq("cover_match_result_id", match["id"] as string).order("position", { ascending: true })).data ?? []) as Record<string, unknown>[]);
  const acceptanceQ = match === null
    ? { data: null }
    : await db.from("client_change_acceptances").select("*").eq("organization_id", org).eq("cover_match_result_id", match["id"] as string).maybeSingle();
  const acceptance = acceptanceQ.data as Record<string, unknown> | null;
  const acceptanceItems = acceptance === null
    ? []
    : (((await db.from("client_change_acceptance_items").select("*").eq("organization_id", org).eq("client_change_acceptance_id", acceptance["id"] as string)).data ?? []) as Record<string, unknown>[]);

  const people = await names(db, [
    ...instructions.map((i) => i["recorded_by"] as string),
    ...requests.map((r) => r["prepared_by"] as string),
    ...approvals.map((a) => a["approved_by"] as string),
    ...submissions.map((s) => s["recorded_by"] as string),
    response?.["recorded_by"] as string,
    match?.["compared_by"] as string,
    acceptance?.["recorded_by"] as string,
  ]);
  const comparisonVersions = await versionsOf(db, org, instructions.map((i) => i["comparison_id"] as string | null));

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
  const liveApproval = liveRequest === null ? null : (approvals.find((a) => a["placement_request_id"] === liveRequest["id"] && a["superseded_at"] === null) ?? null);
  const submission = liveRequest === null ? null : (submissions.find((s) => s["placement_request_id"] === liveRequest["id"]) ?? null);

  const drift = await driftOf(db, org, instructionRow, p, basis);
  const cover = coverOf(liveRequest, submission, response, cancellation, insurer.name);
  const title = placementTitle(opp.title);

  const matchCurrent = match !== null && match["basis_version_id"] === basis.id && match["placement_insurer_response_id"] === response?.["id"];
  const coverMatch: PlacementResponse["coverMatch"] = match === null
    ? null
    : {
        id: match["id"] as string,
        comparedAt: match["compared_at"] as string,
        comparedByName: match["compared_by"] === null ? null : (people.get(match["compared_by"] as string) ?? null),
        basisVersion: basis.id === match["basis_version_id"] ? basis.version : Math.max(1, basis.version - 1),
        current: matchCurrent,
        staleReason: matchCurrent
          ? null
          : match["basis_version_id"] !== basis.id
            ? "What the client accepted has changed since this check."
            : "The insurer's answer has changed since this check.",
        materialDifferences: match["material_differences"] as number,
        unclearCount: match["unclear_count"] as number,
        items: matchItems.map((it) => ({
          id: it["id"] as string,
          field: it["field"] as string,
          termType: (it["term_type"] as string | null) ?? null,
          label: it["label"] as string,
          acceptedValue: (it["accepted_value"] as string | null) ?? null,
          confirmedValue: (it["confirmed_value"] as string | null) ?? null,
          classification: it["classification"] as NonNullable<PlacementResponse["coverMatch"]>["items"][number]["classification"],
          material: Boolean(it["material"]),
        })),
      };

  const changeAcceptance: PlacementResponse["changeAcceptance"] = acceptance === null
    ? null
    : {
        decision: acceptance["decision"] as NonNullable<PlacementResponse["changeAcceptance"]>["decision"],
        decidedAt: acceptance["decided_at"] as string,
        source: acceptance["source"] as ClientInstructionView["source"],
        evidence: evidence(acceptance, "Recorded by a person."),
        recordedByName: people.get(acceptance["recorded_by"] as string) ?? null,
        items: acceptanceItems.map((ai) => ({
          label: (matchItems.find((mi) => mi["id"] === ai["cover_match_item_id"])?.["label"] as string | undefined) ?? "A term",
          decision: ai["decision"] as "accepted" | "rejected" | "clarify",
        })),
        followUpDraft: followUpDraft(acceptance["decision"] as string, insurer.name, client.name, acceptanceItems, matchItems),
      };

  const view: PlacementResponse = {
    placement: { id: p.id, title, requestedEffectiveAt: p.requested_effective_at, requestedExpiryAt: p.requested_expiry_at, createdAt: p.created_at },
    client,
    opportunity: { id: opp.id, title: opp.title, classOfBusiness: opp.class_of_business },
    insurer,
    workItem: { id: homeWork.id, taskStatus: homeWork.task_status, taskParty: homeWork.task_party, taskSince: homeWork.task_since },
    work: [],
    instruction,
    instructionHistory: instructions.filter((i) => i["id"] !== instructionRow["id"]).map(toInstruction),
    basis: {
      version: basis.version,
      origin: basis.origin,
      classOfBusiness: basis.classOfBusiness,
      subject: basis.subject,
      effectiveAt: basis.effectiveAt,
      expiryAt: basis.expiryAt,
      premiumBasis: basis.premiumBasis,
      clientConditions: basis.clientConditions,
      premiumAmount: basis.premiumAmount,
      premiumCurrency: basis.premiumCurrency,
      validUntil: (p["basis_valid_until"] as string | null) ?? null,
      terms: basis.terms,
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
            approval: liveApproval === null ? null : { approvedByName: people.get(liveApproval["approved_by"] as string) ?? null, approvedAt: liveApproval["approved_at"] as string },
            submission:
              submission === null
                ? null
                : {
                    method: submission["method"] as "recorded_manual_email",
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
        approvedAt: (approvals.find((a) => a["placement_request_id"] === r["id"])?.["approved_at"] as string | undefined) ?? null,
        supersededAt: (r["superseded_at"] as string | null) ?? null,
        supersededReason: (r["superseded_reason"] as string | null) ?? null,
      })),
    insurerResponse:
      response === null
        ? null
        : {
            id: response["id"] as string,
            outcome: response["outcome"] as NonNullable<PlacementResponse["insurerResponse"]>["outcome"],
            confirmedPremiumAmount: (response["confirmed_premium_amount"] as string | null) ?? null,
            confirmedPremiumCurrency: (response["confirmed_premium_currency"] as string | null) ?? null,
            confirmedPremiumBasis: (response["confirmed_premium_basis"] as string | null) ?? null,
            confirmedSubject: (response["confirmed_subject"] as string | null) ?? null,
            confirmedClassOfBusiness: (response["confirmed_class_of_business"] as string | null) ?? null,
            terms: confirmationTerms.map((t) => ({
              termType: t["term_type"] as QuoteTermType,
              label: t["label"] as string,
              value: (t["value"] as string | null) ?? null,
              amount: (t["amount"] as string | null) ?? null,
              currency: (t["currency"] as string | null) ?? null,
              unclear: Boolean(t["unclear"]),
            })),
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
    cancellation: cancellation === null ? null : { cancelledAt: cancellation["cancelled_at"] as string, reason: cancellation["reason"] as string, evidence: evidence(cancellation, "Recorded by a person.") },
    cover,
    blockers: [],
    nextAction: "",
    permissions: {
      canRecordInstruction: hasPermission(ctx, "placement", "create"),
      canPrepare: hasPermission(ctx, "placement", "edit"),
      canApprove: hasPermission(ctx, "placement", "approve"),
      canRecordSubmission: hasPermission(ctx, "placement", "send_external"),
      canRecordResponse: hasPermission(ctx, "placement", "edit"),
      approverRoles: await approverRoles(db, org),
    },
    sending: { available: false, reason: SENDING_REASON },
    coverMatch,
    changeAcceptance,
    readiness: { state: "blocked", reasons: [], deferredChecks: [], workItemId: null },
    preparedActions: await preparedFor(db, org, id, people),
  };

  const abandoned = p.abandoned_at !== null;
  const target = abandoned ? null : desiredWork(view);

  /* Work: synced when an action or a blocked attempt asks, and when opening shows a mismatch. */
  let open = await openWorkFor(db, org, id);
  const agrees =
    target === null
      ? open.length === 0
      : open.length === 1 && open[0]!.reason === target.reason && open[0]!.taskStatus === target.status && open[0]!.taskParty === target.party;
  if (options.sync === true || !agrees) {
    open = await syncPlacementWork(db, workContext(org, view), target);
  }

  const owners = await names(db, open.map((o) => o.ownerId));
  view.work = open.map((o) => toWorkView(o, owners));
  view.readiness = readinessOf(view);
  view.blockers = blockersOf(view);
  view.nextAction = target === null ? (abandoned ? "Nothing further: this placement was abandoned." : "Nothing further.") : REASON_COPY[target.reason].action;
  return view;
}

function toWorkView(o: OpenWork, owners: Map<string, string>): PlacementResponse["work"][number] {
  const copy = REASON_COPY[o.reason];
  return {
    id: o.id,
    reason: o.reason,
    headline: copy.headline,
    why: copy.why,
    action: copy.action,
    evidence: copy.evidence,
    after: copy.after,
    taskStatus: o.taskStatus,
    taskParty: o.taskParty,
    taskSince: o.taskSince,
    taskNextCheck: o.taskNextCheck,
    ownerName: o.ownerId === null ? null : (owners.get(o.ownerId) ?? null),
  };
}

/** Which one Work reason the facts call for now. */
export function desiredWork(view: PlacementResponse): WorkTarget | null {
  const now = new Date().toISOString();
  const r = view.request;
  const ir = view.insurerResponse;
  if (view.cancellation !== null) return null;
  const at = (reason: WorkTarget["reason"], status: WorkTarget["status"] = "needs_you", party: string | null = null, since: string | null = now): WorkTarget => ({ reason, status, party, since, owner: null });

  if (view.drift.stale && (r === null || r.submission === null)) return at("quote_moved");
  if (r === null) return at("prepare_request");
  if (r.approval === null) return at("approval_required");
  if (r.submission === null) return at("submission_proof_missing");
  if (ir === null) return at("awaiting_insurer", "with_party", view.insurer.name, r.submission.sentAt);
  if (ir.outcome === "more_information_required") return at("insurer_needs_information");
  if (ir.outcome === "declined") return at("insurer_declined");

  const m = view.coverMatch;
  if (m === null || !m.current) return at("verify_cover_match");
  if (m.materialDifferences === 0) return at("issue_policy");
  const a = view.changeAcceptance;
  if (a === null) return at("review_changed_terms");
  if (a.decision === "partial") return at("clarify_changes");
  if (a.decision === "reject") return at("resolve_rejected_changes");
  return at("verify_cover_match");
}

/**
 * Whether policy issuance may begin, with every reason it may not. Payment is recorded as a
 * deferred check, not enforced: it becomes a company rule when Money exists (4D).
 */
export function readinessOf(view: PlacementResponse): PlacementResponse["readiness"] {
  const reasons: { code: string; message: string }[] = [];
  const ir = view.insurerResponse;
  const confirmed = ir !== null && (ir.outcome === "confirmed_as_requested" || ir.outcome === "confirmed_with_changes");

  if (view.cancellation !== null) reasons.push({ code: "cancelled", message: "This cover was cancelled." });
  if (view.request?.submission == null) reasons.push({ code: "not_submitted", message: "There is no evidence the request reached the insurer." });
  if (!confirmed) reasons.push({ code: "not_confirmed", message: "The insurer has not confirmed cover." });
  if (confirmed && ir.evidence.kind === "note" && ir.evidence.label.trim().length < 10) {
    reasons.push({ code: "no_confirmation_evidence", message: "The confirmation has no evidence behind it." });
  }
  if (confirmed && ir.effectiveAt === null) reasons.push({ code: "no_effective_date", message: "The confirmation does not say when cover begins." });
  if (view.instruction.supersededAt !== null) reasons.push({ code: "instruction_superseded", message: "The client's instruction behind this placement is no longer current." });
  if (confirmed) {
    const m = view.coverMatch;
    if (m === null) reasons.push({ code: "cover_not_checked", message: "The confirmation has not been checked against what the client accepted." });
    else if (!m.current) reasons.push({ code: "cover_check_stale", message: `The cover check is out of date: ${m.staleReason ?? "an input moved."}` });
    else if (m.materialDifferences > 0) {
      const a = view.changeAcceptance;
      reasons.push({
        code: "unaccepted_differences",
        message:
          a === null
            ? `The confirmed terms differ from what the client accepted in ${m.materialDifferences} ${m.materialDifferences === 1 ? "place" : "places"}, and the client has not accepted them.`
            : a.decision === "reject"
              ? "The client rejected the insurer's changes."
              : "The client accepted only some of the insurer's changes.",
      });
    }
  }
  if (!view.permissions.canPrepare) reasons.push({ code: "not_permitted", message: "You may not prepare policy issuance." });

  const issuanceWork = view.work.find((w) => w.reason === "issue_policy") ?? null;
  return {
    state: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    deferredChecks: ["Whether premium must be paid before issuance is a brokerage rule that arrives with Money (4D). It is not checked, and not assumed."],
    workItemId: issuanceWork?.id ?? null,
  };
}

function blockersOf(view: PlacementResponse): string[] {
  const out: string[] = [];
  if (view.drift.stale) {
    out.push(`The quotation changed after the client accepted it: ${view.drift.changes.map((c) => c.label).join(", ") || "a new revision exists"}. Nothing can be sent until it is reviewed.`);
  }
  const top = view.work[0];
  if (top !== undefined && top.reason !== "issue_policy") out.push(top.why);
  const ir = view.insurerResponse;
  if (ir?.outcome === "more_information_required") out.push(`${view.insurer.name} needs: ${ir.informationRequired ?? ""}`);
  if (ir?.outcome === "declined") out.push(`${view.insurer.name} declined: ${ir.declineReason ?? ""}`);
  const m = view.coverMatch;
  if (m?.current && m.materialDifferences > 0) {
    out.push(
      `${view.insurer.name}'s confirmed terms differ from what the client accepted: ${m.items.filter((i) => i.material).map((i) => i.label).join(", ")}.${view.cover.state === "active" ? " The cover is in force on the insurer's terms; the client has not agreed to them." : ""}`,
    );
  }
  return [...new Set(out)];
}

function followUpDraft(
  decision: string,
  insurerName: string,
  clientName: string,
  items: Record<string, unknown>[],
  matchItems: Record<string, unknown>[],
): string | null {
  if (decision === "accept_all") return null;
  const label = (id: unknown) => (matchItems.find((m) => m["id"] === id)?.["label"] as string | undefined) ?? "a term";
  const rejected = items.filter((i) => i["decision"] === "rejected").map((i) => label(i["cover_match_item_id"]));
  const queried = items.filter((i) => i["decision"] === "clarify").map((i) => label(i["cover_match_item_id"]));
  const lines = [
    "Dear Underwriter,",
    "",
    `Our client ${clientName} has reviewed your confirmation.`,
    ...(rejected.length === 0 ? [] : [`They do not accept the change to: ${rejected.join(", ")}. Please confirm cover on the terms requested.`]),
    ...(queried.length === 0 ? [] : [`They ask you to clarify: ${queried.join(", ")}.`]),
    "",
    "Kind regards",
  ];
  return `Draft to ${insurerName} — not sent:\n\n${lines.join("\n")}`;
}

/** A placement opened before 0055 has no basis version; read the frozen columns instead. */
function legacyBasis(p: Record<string, unknown>): Basis {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    version: 1,
    origin: "instruction",
    insurerId: p["insurer_id"] as string,
    classOfBusiness: null,
    subject: null,
    effectiveAt: p["requested_effective_at"] as string,
    expiryAt: (p["requested_expiry_at"] as string | null) ?? null,
    premiumAmount: (p["basis_premium_amount"] as string | null) ?? null,
    premiumCurrency: (p["basis_premium_currency"] as string | null) ?? null,
    premiumBasis: null,
    clientConditions: null,
    terms: [],
  };
}

/* ---- Prepared actions visible on the placement ----------------------------------------------- */

async function preparedFor(db: SupabaseClient, org: string, placementId: string, people: Map<string, string>): Promise<PreparedActionView[]> {
  const { data } = await db
    .from("prepared_actions")
    .select("*")
    .eq("organization_id", org)
    .eq("placement_id", placementId)
    .order("prepared_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Record<string, unknown>[];
  const more = await names(db, rows.flatMap((r) => [r["prepared_by"] as string, r["decided_by"] as string]));
  return rows.map((r) => toPreparedView(r, new Map([...people, ...more])));
}

export function toPreparedView(r: Record<string, unknown>, people: Map<string, string>): PreparedActionView {
  const receipt = r["receipt"] as { message?: string; at?: string } | null;
  return {
    id: r["id"] as string,
    actionType: r["action_type"] as PreparedActionView["actionType"],
    placementId: (r["placement_id"] as string | null) ?? null,
    opportunityId: (r["opportunity_id"] as string | null) ?? null,
    summary: ((r["changes"] as string[] | null) ?? [])[0] ?? "A prepared action",
    changes: ((r["changes"] as string[] | null) ?? []).slice(1),
    blockers: (r["blockers"] as string[] | null) ?? [],
    permitted: Boolean(r["permitted"]),
    requiresConfirmation: Boolean(r["requires_confirmation"]),
    state: r["state"] as PreparedActionView["state"],
    preparedAt: r["prepared_at"] as string,
    expiresAt: r["expires_at"] as string,
    preparedByName: people.get(r["prepared_by"] as string) ?? null,
    receipt:
      receipt === null || receipt === undefined
        ? null
        : { message: receipt.message ?? "", at: receipt.at ?? (r["decided_at"] as string), by: people.get(r["decided_by"] as string) ?? null },
  };
}

/**
 * A fingerprint of every fact a prepared action rests on. If any moves before a person confirms,
 * the fingerprint differs and the action is refused as stale.
 */
export function fingerprintOf(view: PlacementResponse): { versions: Record<string, unknown>; fingerprint: string } {
  const versions = {
    instruction: view.instruction.id,
    basisVersion: view.basis.version,
    request: view.request?.id ?? null,
    requestDigest: view.request?.sha256 ?? null,
    approved: view.request?.approval?.approvedAt ?? null,
    submitted: view.request?.submission?.sentAt ?? null,
    insurerResponse: view.insurerResponse?.id ?? null,
    coverMatch: view.coverMatch?.id ?? null,
    coverMatchCurrent: view.coverMatch?.current ?? null,
    acceptance: view.changeAcceptance?.decidedAt ?? null,
    cancelled: view.cancellation?.cancelledAt ?? null,
    quoteDrift: view.drift.stale,
  };
  return { versions, fingerprint: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
}

/* ---- Helpers ----------------------------------------------------------------------------------- */

async function nameOf(db: SupabaseClient, org: string, table: string, id: string): Promise<string | null> {
  const { data } = await db.from(table).select("name").eq("organization_id", org).eq("id", id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function latestRevision(db: SupabaseClient, org: string, table: string, column: string, rowId: string): Promise<string | null> {
  const { data } = await db.from(table).select("id, revision").eq("organization_id", org).eq(column, rowId).order("revision", { ascending: false }).limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function approversOf(db: SupabaseClient, org: string): Promise<{ userId: string; name: string }[]> {
  const rolesQ = await db.from("roles").select("id, name").eq("organization_id", org);
  const roles = (rolesQ.data ?? []) as { id: string; name: string }[];
  if (roles.length === 0) return [];
  const grantsQ = await db.from("role_permissions").select("role_id, permission:permissions ( object_type, verb )").in("role_id", roles.map((r) => r.id));
  const approving = new Set(
    ((grantsQ.data ?? []) as unknown as { role_id: string; permission: { object_type: string; verb: string } | null }[])
      .filter((g) => g.permission?.object_type === "placement" && g.permission.verb === "approve")
      .map((g) => g.role_id),
  );
  const members = await db.from("organization_memberships").select("user_id, status, role").eq("organization_id", org).eq("status", "active");
  const people = ((members.data ?? []) as { user_id: string; role: { id: string } | null }[]).filter((m) => m.role !== null && approving.has(m.role.id));
  const who = await names(db, people.map((m) => m.user_id));
  return people.map((m) => ({ userId: m.user_id, name: who.get(m.user_id) ?? "A colleague" }));
}

async function approverRoles(db: SupabaseClient, org: string): Promise<string[]> {
  const rolesQ = await db.from("roles").select("id, name").eq("organization_id", org);
  const roles = (rolesQ.data ?? []) as { id: string; name: string }[];
  if (roles.length === 0) return [];
  const grantsQ = await db.from("role_permissions").select("role_id, permission:permissions ( object_type, verb )").in("role_id", roles.map((r) => r.id));
  const approving = new Set(
    ((grantsQ.data ?? []) as unknown as { role_id: string; permission: { object_type: string; verb: string } | null }[])
      .filter((g) => g.permission?.object_type === "placement" && g.permission.verb === "approve")
      .map((g) => g.role_id),
  );
  return roles.filter((r) => approving.has(r.id)).map((r) => r.name).sort();
}

export async function whoMayApproveSuffix(db: SupabaseClient, org: string): Promise<string> {
  const roles = await approverRoles(db, org);
  return roles.length === 0 ? "" : ` — ask someone who is a ${roles.join(" or ")}`;
}

function evidence(row: Record<string, unknown>, fallback: string): EvidenceRef {
  const documentId = (row["evidence_document_id"] as string | null) ?? null;
  if (documentId !== null) return { kind: "document", id: documentId, label: "The attached document", path: `/documents/${documentId}` };
  const emailId = ((row["evidence_email_message_id"] ?? row["provider_message_id"]) as string | null) ?? null;
  if (emailId !== null) return { kind: "email", id: emailId, label: "The linked email", path: null };
  const note = (row["evidence_note"] as string | null) ?? null;
  return { kind: "note", id: null, label: note ?? fallback, path: null };
}

export async function names(db: SupabaseClient, ids: (string | undefined | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data } = await db.from("users").select("id, full_name").in("id", wanted);
  for (const r of (data ?? []) as { id: string; full_name: string | null }[]) if (r.full_name) out.set(r.id, r.full_name);
  return out;
}

async function versionsOf(db: SupabaseClient, org: string, ids: (string | null)[]): Promise<Map<string, number>> {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  const out = new Map<string, number>();
  if (wanted.length === 0) return out;
  const { data } = await db.from("quote_comparisons").select("id, version").eq("organization_id", org).in("id", wanted);
  for (const r of (data ?? []) as { id: string; version: number | null }[]) out.set(r.id, r.version ?? 1);
  return out;
}

/** What moved since the client accepted, revision to revision, as accepted → now. */
async function driftOf(db: SupabaseClient, org: string, instruction: Record<string, unknown>, placement: Record<string, unknown>, basis: Basis): Promise<PlacementResponse["drift"]> {
  /* Once the client has accepted the insurer's own terms, the quote is no longer what they rest on. */
  if (basis.origin === "client_accepted_changes") return { stale: false, changes: [] };
  const responseId = instruction["insurer_response_id"] as string;
  const latest = await db
    .from("insurer_response_revisions")
    .select("id, premium_amount, premium_currency, valid_until, revision")
    .eq("organization_id", org)
    .eq("insurer_response_id", responseId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  const now = latest.data as Record<string, unknown> | null;
  const changes: PlacementResponse["drift"]["changes"] = [];
  const moved = now !== null && now["id"] !== instruction["response_revision_id"];

  if (moved) {
    const money = (a: unknown, c: unknown) => (a === null || a === undefined ? null : `${String(c ?? "")} ${Number(a).toLocaleString("en-KE")}`.trim());
    const wasPremium = money(placement["basis_premium_amount"], placement["basis_premium_currency"]);
    const nowPremium = money(now!["premium_amount"], now!["premium_currency"]);
    if (wasPremium !== nowPremium) changes.push({ label: "Premium", was: wasPremium, now: nowPremium });
    if ((placement["basis_valid_until"] ?? null) !== (now!["valid_until"] ?? null)) {
      changes.push({ label: "Valid until", was: (placement["basis_valid_until"] as string | null) ?? null, now: (now!["valid_until"] as string | null) ?? null });
    }
  }

  const basisTerms = await db
    .from("placement_basis_terms")
    .select("quote_term_revision_id, label, value")
    .eq("organization_id", org)
    .eq("placement_id", placement["id"] as string);
  for (const b of (basisTerms.data ?? []) as Record<string, unknown>[]) {
    if (b["quote_term_revision_id"] === null) continue;
    const frozen = await db.from("quote_term_revisions").select("quote_term_id").eq("organization_id", org).eq("id", b["quote_term_revision_id"] as string).maybeSingle();
    const termId = (frozen.data as { quote_term_id: string | null } | null)?.quote_term_id ?? null;
    if (termId === null) {
      changes.push({ label: b["label"] as string, was: (b["value"] as string | null) ?? null, now: null });
      continue;
    }
    const newest = await db.from("quote_term_revisions").select("id, extracted_value, corrected_value, revision").eq("organization_id", org).eq("quote_term_id", termId).order("revision", { ascending: false }).limit(1).maybeSingle();
    const n = newest.data as Record<string, unknown> | null;
    if (n !== null && n["id"] !== b["quote_term_revision_id"]) {
      changes.push({ label: b["label"] as string, was: (b["value"] as string | null) ?? null, now: ((n["corrected_value"] as string | null) ?? (n["extracted_value"] as string | null)) ?? null });
    }
  }
  return { stale: changes.length > 0 || moved, changes };
}

/**
 * The cover-period line, derived. "Active cover" follows the insurer's own effective date — even
 * where the insurer changed the terms and the client has not accepted them. That is insurance
 * reality, and it is shown as it is; the disagreement is shown beside it, never instead of it.
 */
export function coverOf(
  request: Record<string, unknown> | null,
  submission: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  cancellation: Record<string, unknown> | null,
  insurerName: string,
  now: Date = new Date(),
): PlacementResponse["cover"] {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (cancellation !== null) return { state: "cancelled", line: `Cancelled from ${day(cancellation["cancelled_at"] as string)}.` };

  const outcome = response?.["outcome"] as string | undefined;
  if (outcome === "confirmed_as_requested" || outcome === "confirmed_with_changes") {
    const effective = new Date(response!["effective_at"] as string);
    const expiry = response!["expiry_at"] === null || response!["expiry_at"] === undefined ? null : new Date(response!["expiry_at"] as string);
    const changed = outcome === "confirmed_with_changes" ? " on the insurer's changed terms" : "";
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
  if (outcome === "declined") return { state: null, line: `${insurerName} declined. There is no cover.` };
  if (submission !== null) return { state: "submitted", line: `Sent to ${insurerName} on ${day(submission["sent_at"] as string)}. Not confirmed — there is no cover yet.` };
  if (request !== null) return { state: "requested", line: "A request is prepared. It has not been sent, and there is no cover." };
  return { state: null, line: "Nothing has been requested from the insurer yet." };
}
