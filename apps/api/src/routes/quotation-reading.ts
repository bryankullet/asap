import {
  quotationReadingResponseSchema,
  quotationReviewActionSchema,
  quotationReviewResponseSchema,
  type QuotationReadingResponse,
  type QuoteTermType,
  type TermProposal,
} from "@asap/schema";
import { Hono } from "hono";
import { pgMoney } from "../numeric.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * Reading a quotation, and the review between reading it and believing it.
 *
 * The lifecycle this serves is one direction only: the document is read, the reading is proposed
 * with the page and rectangle it came from, a person accepts, corrects or rejects each one, and
 * only then does anything become a confirmed term. Nothing here writes a term a person has not
 * decided on, and a later re-read cannot touch one they have.
 *
 * Which insurer's answer a quotation belongs to is always chosen by a person. An extracted
 * "Jubilee Alliance" is not evidence that this brokerage's "Jubilee Insurance" sent it, and the
 * cost of guessing that is one insurer's terms recorded against another's.
 */

type Ctx = Awaited<ReturnType<typeof resolveContext>>;

export function quotationReadingRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/documents/:id/quotation", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(
      quotationReadingResponseSchema.parse(await load(db, ctx, org.id, c.req.param("id"))),
    );
  });

  app.post("/documents/:id/quotation/actions", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const documentId = c.req.param("id");
    const input = await parseBody(c, quotationReviewActionSchema);

    const blocked = (reason: string) =>
      c.json(quotationReviewResponseSchema.parse({ outcome: "blocked", reason }));
    const done = async (outcome: "done" | "already" = "done") =>
      c.json(
        quotationReviewResponseSchema.parse({
          outcome,
          reading: await load(db, ctx, org.id, documentId),
        }),
      );

    /* Reviewing an extraction changes what the brokerage believes. It needs the same gate. */
    if (!hasPermission(ctx, "document", "edit")) {
      return blocked("You may not review what was read from documents.");
    }

    const document = await db
      .from("documents")
      .select("id, client_id, extraction_state")
      .eq("organization_id", org.id)
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!document.data) throw new HttpError(404, "not_found", "No document with that id");
    const doc = document.data as { id: string; client_id: string | null; extraction_state: string };

    const now = new Date().toISOString();

    if (input.action === "read_document") {
      /*
       * Re-reading is queued, not performed here: a request thread is the wrong place for it,
       * and the pipeline already refuses to re-read a document whose proposals have been
       * decided on. Nothing in this deployment runs it yet, so this says so rather than
       * appearing to have started something.
       */
      return blocked(
        "Re-reading a document is not wired up in this deployment yet. The reading below is the one ASAP already has.",
      );
    }

    if (input.action === "link_to_response") {
      const response = await db
        .from("insurer_responses")
        .select("id, opportunity_id, source_document_id")
        .eq("organization_id", org.id)
        .eq("id", input.insurerResponseId)
        .maybeSingle();
      const row = response.data as
        | { id: string; opportunity_id: string; source_document_id: string | null }
        | null;
      /* A response in another brokerage simply does not exist to this query, and says so. */
      if (row === null) return blocked("That insurer's answer is not part of this brokerage.");
      if (row.source_document_id === documentId) return done("already");
      if (row.source_document_id !== null) {
        return blocked("That answer already has a quotation document against it.");
      }

      /* The client has to match: a quotation on one client's file is not another's terms. */
      const opportunity = await db
        .from("opportunities")
        .select("id, client_id")
        .eq("organization_id", org.id)
        .eq("id", row.opportunity_id)
        .maybeSingle();
      const opp = opportunity.data as { client_id: string } | null;
      if (opp === null) return blocked("That quotation work is not part of this brokerage.");
      if (doc.client_id !== null && doc.client_id !== opp.client_id) {
        return blocked(
          "That document is on a different client's file. Move it first, or choose an answer for the client it belongs to.",
        );
      }

      /*
       * One quotation document belongs to one answer. The partial unique index in 0053 refuses
       * the second, but this reads it first so the person gets a sentence rather than a
       * constraint — and so the refusal is the same whichever way the race goes.
       */
      const taken = await db
        .from("insurer_responses")
        .select("id")
        .eq("organization_id", org.id)
        .eq("source_document_id", documentId)
        .maybeSingle();
      if (taken.data !== null) {
        return blocked("That document is already the source for another insurer's answer.");
      }

      const linked = await db
        .from("insurer_responses")
        .update({ source_document_id: documentId, updated_at: now })
        .eq("organization_id", org.id)
        .eq("id", row.id)
        .select("id")
        .maybeSingle();
      if (linked.error) {
        /* The unique index refuses a second answer for the same document (0053). */
        return blocked("That document is already the source for another insurer's answer.");
      }

      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "document.linked_to_quote",
        objectType: "document",
        objectId: documentId,
        result: "success",
        newState: { insurerResponseId: row.id },
      });
      return done();
    }

    /* The three review decisions. All of them need the proposal and the answer it belongs to. */
    const proposalQ = await db
      .from("document_term_proposals")
      .select(
        "id, document_id, ordinal, term_type, label, proposed_value, amount, currency, page_number, region_x, region_y, region_width, region_height, condition, state, quote_term_id",
      )
      .eq("organization_id", org.id)
      .eq("id", input.proposalId)
      .maybeSingle();
    const proposal = proposalQ.data as ProposalRow | null;
    if (proposal === null || proposal.document_id !== documentId) {
      return blocked("That reading is not part of this document.");
    }
    if (proposal.state !== "proposed") return done("already");

    if (input.action === "reject_proposal") {
      const rejected = await db
        .from("document_term_proposals")
        .update({ state: "rejected", reviewed_by: user.id, reviewed_at: now })
        .eq("organization_id", org.id)
        .eq("id", proposal.id)
        .eq("state", "proposed")
        .select("id")
        .maybeSingle();
      if (rejected.error) return sendError(c, mapDatabaseError(rejected.error));

      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "document.term_rejected",
        objectType: "document",
        objectId: documentId,
        result: "success",
        /* The label and the decision. The value stays in the business record, not the audit. */
        newState: { proposalId: proposal.id, termType: proposal.term_type, label: proposal.label },
      });
      return done();
    }

    /* Accepting or correcting writes a confirmed term, so the answer must be chosen first. */
    const target = await db
      .from("insurer_responses")
      .select("id, organization_id")
      .eq("organization_id", org.id)
      .eq("source_document_id", documentId)
      .maybeSingle();
    const response = target.data as { id: string } | null;
    if (response === null) {
      return blocked(
        "Choose which insurer's answer this quotation is, before accepting anything from it.",
      );
    }

    const value =
      input.action === "correct_proposal" ? input.correctedValue : proposal.proposed_value;
    if (value === null && proposal.amount === null) {
      return blocked("There is nothing here to record. Correct it, or reject it.");
    }

    /* What the term said before this, so the proposal records what it replaced. */
    const existing = await db
      .from("quote_terms")
      .select("id")
      .eq("organization_id", org.id)
      .eq("insurer_response_id", response.id)
      .eq("term_type", proposal.term_type)
      .eq("label", proposal.label)
      .maybeSingle();
    const already = existing.data as { id: string } | null;

    let termId: string;
    let previousRevisionId: string | null = null;

    if (already === null) {
      const created = await db
        .from("quote_terms")
        .insert({
          organization_id: org.id,
          insurer_response_id: response.id,
          term_type: proposal.term_type,
          label: proposal.label,
          extracted_value: proposal.proposed_value,
          corrected_value: input.action === "correct_proposal" ? input.correctedValue : null,
          corrected_by: input.action === "correct_proposal" ? user.id : null,
          corrected_at: input.action === "correct_proposal" ? now : null,
          amount: pgMoney(proposal.amount),
          currency: proposal.currency,
          unclear: proposal.condition === "unclear",
          evidence_document_id: documentId,
          evidence_page: proposal.page_number,
          region_x: proposal.region_x,
          region_y: proposal.region_y,
          region_width: proposal.region_width,
          region_height: proposal.region_height,
        })
        .select("id")
        .maybeSingle();
      if (created.error || !created.data) {
        return blocked("That term could not be recorded against this answer.");
      }
      termId = (created.data as { id: string }).id;
    } else {
      termId = already.id;
      previousRevisionId = await latestRevisionOf(db, org.id, termId);
      const updated = await db
        .from("quote_terms")
        .update({
          corrected_value: input.action === "correct_proposal" ? input.correctedValue : null,
          corrected_by: input.action === "correct_proposal" ? user.id : null,
          corrected_at: input.action === "correct_proposal" ? now : null,
          evidence_document_id: documentId,
          evidence_page: proposal.page_number,
        })
        .eq("organization_id", org.id)
        .eq("id", termId)
        .select("id")
        .maybeSingle();
      if (updated.error) return sendError(c, mapDatabaseError(updated.error));
    }

    const decided = await db
      .from("document_term_proposals")
      .update({
        state: input.action === "correct_proposal" ? "corrected" : "accepted",
        corrected_value: input.action === "correct_proposal" ? input.correctedValue : null,
        reviewed_by: user.id,
        reviewed_at: now,
        quote_term_id: termId,
        previous_revision_id: previousRevisionId,
      })
      .eq("organization_id", org.id)
      .eq("id", proposal.id)
      .eq("state", "proposed")
      .select("id")
      .maybeSingle();
    if (decided.error) return sendError(c, mapDatabaseError(decided.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: input.action === "correct_proposal" ? "document.term_corrected" : "document.term_accepted",
      objectType: "document",
      objectId: documentId,
      result: "success",
      newState: {
        proposalId: proposal.id,
        quoteTermId: termId,
        termType: proposal.term_type,
        label: proposal.label,
      },
    });
    return done();
  });

  return app;
}

type ProposalRow = {
  id: string;
  document_id: string;
  ordinal: number;
  term_type: QuoteTermType;
  label: string;
  proposed_value: string | null;
  amount: string | null;
  currency: string | null;
  page_number: number | null;
  region_x: string | null;
  region_y: string | null;
  region_width: string | null;
  region_height: string | null;
  condition: TermProposal["condition"];
  state: TermProposal["state"];
  quote_term_id: string | null;
};

async function latestRevisionOf(
  db: SupabaseClient,
  organizationId: string,
  termId: string,
): Promise<string | null> {
  const { data } = await db
    .from("quote_term_revisions")
    .select("id, revision")
    .eq("organization_id", organizationId)
    .eq("quote_term_id", termId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function load(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  documentId: string,
): Promise<QuotationReadingResponse> {
  const documentQ = await db
    .from("documents")
    .select("id, filename, page_count, extraction_state, extraction_error")
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (documentQ.error) throw mapDatabaseError(documentQ.error);
  if (!documentQ.data) throw new HttpError(404, "not_found", "No document with that id");
  const doc = documentQ.data as {
    id: string;
    filename: string;
    page_count: number | null;
    extraction_state: string;
    extraction_error: string | null;
  };

  const [fieldsQ, proposalsQ, responseQ] = await Promise.all([
    db
      .from("document_fields")
      .select("field_key, proposed_value, corrected_value, page_number, condition, state")
      .eq("organization_id", organizationId)
      .eq("document_id", documentId)
      .order("field_key", { ascending: true }),
    db
      .from("document_term_proposals")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("document_id", documentId)
      .order("ordinal", { ascending: true }),
    db
      .from("insurer_responses")
      .select("id, opportunity_id, opportunity_insurer_id")
      .eq("organization_id", organizationId)
      .eq("source_document_id", documentId)
      .maybeSingle(),
  ]);
  if (fieldsQ.error) throw mapDatabaseError(fieldsQ.error);
  if (proposalsQ.error) throw mapDatabaseError(proposalsQ.error);

  const rows = (proposalsQ.data ?? []) as (ProposalRow & {
    corrected_value: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    method: string;
  })[];

  const reviewers = new Map<string, string>();
  const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter((v): v is string => v !== null))];
  if (reviewerIds.length > 0) {
    const { data } = await db.from("users").select("id, full_name").in("id", reviewerIds);
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) reviewers.set(p.id, p.full_name);
    }
  }

  let linkedTo: QuotationReadingResponse["linkedTo"] = null;
  const response = responseQ.data as
    | { id: string; opportunity_id: string; opportunity_insurer_id: string }
    | null;
  if (response !== null) {
    const { data } = await db
      .from("opportunity_insurers")
      .select("insurer_id")
      .eq("organization_id", organizationId)
      .eq("id", response.opportunity_insurer_id)
      .maybeSingle();
    const insurerId = (data as { insurer_id: string } | null)?.insurer_id ?? null;
    const insurer = insurerId === null
      ? null
      : ((await db.from("insurers").select("name").eq("organization_id", organizationId)
            .eq("id", insurerId).maybeSingle()).data as { name: string } | null);
    linkedTo = {
      insurerResponseId: response.id,
      insurerName: insurer?.name ?? "An insurer",
      opportunityId: response.opportunity_id,
    };
  }

  return {
    document: {
      id: doc.id,
      filename: doc.filename,
      pageCount: doc.page_count,
      extractionState: doc.extraction_state,
    },
    needsManualReview: doc.extraction_error,
    linkedTo,
    fields: ((fieldsQ.data ?? []) as Record<string, unknown>[]).map((f) => ({
      fieldKey: f["field_key"] as string,
      proposedValue: (f["proposed_value"] as string | null) ?? null,
      correctedValue: (f["corrected_value"] as string | null) ?? null,
      page: (f["page_number"] as number | null) ?? null,
      condition: f["condition"] as string,
      state: f["state"] as string,
    })),
    proposals: rows.map(
      (r): TermProposal => ({
        id: r.id,
        ordinal: r.ordinal,
        termType: r.term_type,
        label: r.label,
        proposedValue: r.proposed_value,
        amount: pgMoney(r.amount),
        currency: r.currency,
        page: r.page_number,
        region:
          r.region_x === null || r.region_y === null || r.region_width === null || r.region_height === null
            ? null
            : {
                x: Number(r.region_x),
                y: Number(r.region_y),
                width: Number(r.region_width),
                height: Number(r.region_height),
              },
        condition: r.condition,
        method: r.method,
        state: r.state,
        correctedValue: r.corrected_value,
        reviewedByName: r.reviewed_by === null ? null : (reviewers.get(r.reviewed_by) ?? null),
        reviewedAt: r.reviewed_at,
        quoteTermId: r.quote_term_id,
      }),
    ),
    permissions: { canReview: hasPermission(ctx, "document", "edit") },
  };
}
