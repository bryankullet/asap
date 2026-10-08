import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The quote-request writes, shared (D-141). A person's click on "Prepare the request" or "Approve
 * the request" and a workflow step that does the same thing go through these functions and nothing
 * else, so neither can reach a state the other could not — the guards are here, not in a route.
 */

/** The digest an approval covers: subject and body, exactly. */
export function quoteRequestDigest(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\u001e${body}`, "utf8").digest("hex");
}

export type Prepared = { outcome: "prepared" | "replaced"; quoteRequestId: string } | { outcome: "blocked"; reason: string };

/**
 * Prepares (or re-prepares) the one request to one approached insurer. Re-preparing replaces the
 * text and clears any approval: an approval covers one exact body.
 */
export async function prepareQuoteRequest(
  db: SupabaseClient,
  input: { organizationId: string; opportunityId: string; opportunityInsurerId: string; subject: string; body: string; preparedBy: string; now?: string },
): Promise<Prepared> {
  const now = input.now ?? new Date().toISOString();
  const approach = await db.from("opportunity_insurers").select("id, opportunity_id, removed_at").eq("organization_id", input.organizationId).eq("id", input.opportunityInsurerId).maybeSingle();
  const row = approach.data as { id: string; opportunity_id: string; removed_at: string | null } | null;
  if (!row || row.opportunity_id !== input.opportunityId) return { outcome: "blocked", reason: "That insurer is not part of this quotation work." };
  if (row.removed_at !== null) return { outcome: "blocked", reason: "That insurer is no longer being approached." };
  const existing = await db.from("quote_requests").select("id").eq("organization_id", input.organizationId).eq("opportunity_insurer_id", input.opportunityInsurerId).maybeSingle();
  if (existing.data) {
    const id = (existing.data as { id: string }).id;
    const updated = await db
      .from("quote_requests")
      .update({ subject: input.subject, body_text: input.body, approved_body_sha256: null, approved_by: null, approved_at: null, updated_at: now })
      .eq("organization_id", input.organizationId)
      .eq("id", id)
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (updated.error) return { outcome: "blocked", reason: "The request could not be changed." };
    if (!updated.data) return { outcome: "blocked", reason: "That request has already been sent, so it cannot be prepared again." };
    return { outcome: "replaced", quoteRequestId: id };
  }
  const inserted = await db
    .from("quote_requests")
    .insert({ organization_id: input.organizationId, opportunity_id: input.opportunityId, opportunity_insurer_id: input.opportunityInsurerId, subject: input.subject, body_text: input.body, prepared_by: input.preparedBy })
    .select("id")
    .maybeSingle();
  if (inserted.error || !inserted.data) {
    // A concurrent preparation won the unique index: read the winner.
    const again = await db.from("quote_requests").select("id").eq("organization_id", input.organizationId).eq("opportunity_insurer_id", input.opportunityInsurerId).maybeSingle();
    if (again.data) return { outcome: "prepared", quoteRequestId: (again.data as { id: string }).id };
    return { outcome: "blocked", reason: "The request could not be recorded." };
  }
  return { outcome: "prepared", quoteRequestId: (inserted.data as { id: string }).id };
}

export type Approved = { outcome: "approved" | "already"; digest: string } | { outcome: "blocked"; reason: string };

/**
 * A person approves the exact text of one request. The approval and its standing record name the
 * person; the workflow passes the person who approved its bundle, never itself.
 */
export async function approveQuoteRequest(
  db: SupabaseClient,
  input: { organizationId: string; quoteRequestId: string; approverId: string; expectedDigest?: string; now?: string },
): Promise<Approved> {
  const now = input.now ?? new Date().toISOString();
  const req = await db.from("quote_requests").select("id, subject, body_text, approved_at, approved_body_sha256").eq("organization_id", input.organizationId).eq("id", input.quoteRequestId).maybeSingle();
  const row = req.data as { id: string; subject: string; body_text: string; approved_at: string | null; approved_body_sha256: string | null } | null;
  if (!row) return { outcome: "blocked", reason: "That request is not part of this quotation work." };
  const digest = quoteRequestDigest(row.subject, row.body_text);
  // What was shown for approval must be what is approved: a text changed since is refused.
  if (input.expectedDigest && input.expectedDigest !== digest) return { outcome: "blocked", reason: "The request changed after it was shown for approval. Nothing was approved." };
  if (row.approved_at !== null) return { outcome: "already", digest: row.approved_body_sha256 ?? digest };
  const updated = await db
    .from("quote_requests")
    .update({ approved_by: input.approverId, approved_at: now, approved_body_sha256: digest, updated_at: now })
    .eq("organization_id", input.organizationId)
    .eq("id", row.id)
    .is("approved_at", null)
    .select("id")
    .maybeSingle();
  if (updated.error) return { outcome: "blocked", reason: "The approval could not be recorded." };
  if (!updated.data) return { outcome: "already", digest };
  await db.from("quote_request_approvals").insert({ organization_id: input.organizationId, quote_request_id: row.id, body_sha256: digest, approved_by: input.approverId, approved_at: now });
  return { outcome: "approved", digest };
}

/**
 * A quotation request recorded as delivered (D-145) — by a person's own account of it, or by the
 * connected mailbox's send. One path, so the same checks hold either way: the request belongs to
 * this quotation, a person approved its exact text, the delivered text is that text, it is
 * delivered once, and never in the future.
 */
export async function recordQuoteDelivery(
  db: SupabaseClient,
  o: { organizationId: string; opportunityId: string; quoteRequestId: string; method: string; reference: string; deliveredAt: string; evidenceDocumentId: string | null; userId: string },
): Promise<{ outcome: "done" } | { outcome: "already" } | { outcome: "blocked"; reason: string } | { outcome: "error"; error: { code?: string; message?: string } }> {
  const req = await db.from("quote_requests").select("id, opportunity_id, approved_at, approved_body_sha256").eq("organization_id", o.organizationId).eq("id", o.quoteRequestId).maybeSingle();
  const row = req.data as { id: string; opportunity_id: string; approved_at: string | null; approved_body_sha256: string | null } | null;
  if (!row || row.opportunity_id !== o.opportunityId) return { outcome: "blocked", reason: "That request is not part of this quotation work." };
  if (!row.approved_at || !row.approved_body_sha256) return { outcome: "blocked", reason: "This request has not been approved. Approve the exact text before it is delivered." };
  const existing = await db.from("quote_request_deliveries").select("id").eq("organization_id", o.organizationId).eq("quote_request_id", row.id).maybeSingle();
  if (existing.data) return { outcome: "already" };
  if (new Date(o.deliveredAt).getTime() > Date.now() + 5 * 60_000) return { outcome: "blocked", reason: "A delivery cannot be dated in the future." };
  const ins = await db.from("quote_request_deliveries").insert({
    organization_id: o.organizationId, quote_request_id: row.id, method: o.method, reference: o.reference, evidence_document_id: o.evidenceDocumentId,
    // Delivered text is the approved text; the database refuses anything else.
    delivered_body_sha256: row.approved_body_sha256, delivered_at: o.deliveredAt, recorded_by: o.userId,
  });
  if (ins.error) return String(ins.error.code) === "23505" ? { outcome: "already" } : { outcome: "error", error: ins.error };
  return { outcome: "done" };
}
