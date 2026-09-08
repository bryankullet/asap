/**
 * Ported from the prototype's checks.mjs lines 20–21 (UI Build Spec v1 Part 0, Part 7):
 * "a draft without evidence stays unsent". The original: ensureDraft(record); set copiedAt;
 * sentAt is still null; open the sent-review dialog with the confirmation unchecked and evidence
 * empty; save; sentAt still null. Then check the confirmation, type "Sent folder message 42",
 * save; sentAt is set and the newest audit entry's action is "External send recorded by human".
 *
 * The audit action is written by the database function draft_record_send (0023) and asserted
 * here through the shared constant; supabase/tests/0301 proves the row rule on a real database.
 */
import { DraftRow, EXTERNAL_SEND_AUDIT_ACTION } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { canRetry, markCopied, reviewSend } from "./draft.js";

const NOW = new Date("2026-09-08T10:00:00Z");
const draft = (over: Partial<DraftRow> = {}): DraftRow =>
  DraftRow.parse({
    id: "50000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-00000000000a",
    work_item_id: "30000000-0000-4000-8000-000000000001",
    step_id: "request_terms",
    to_address: "Jubilee",
    subject: "Acme Motors — renewal terms request",
    body: "Please quote.",
    copied_at: null,
    sent_at: null,
    sent_evidence: null,
    outcome_unknown: false,
    created_by: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  });

describe("drafts — a draft without evidence stays unsent", () => {
  it("copying sets copiedAt and sentAt stays null", () => {
    const d = markCopied(draft(), NOW);
    expect(d.copied_at).toBe(NOW.toISOString());
    expect(d.sent_at).toBeNull();
    expect(markCopied(d, new Date("2026-09-09T00:00:00Z")).copied_at).toBe(NOW.toISOString());
  });

  it("recording a send without the confirmation and evidence is refused, so sentAt stays null", () => {
    const d = markCopied(draft(), NOW);
    expect(reviewSend(d, { confirmed: false, evidence: "" })).toEqual({
      ok: false,
      reason: "Confirm that you sent it and say where the evidence is.",
    });
    expect(reviewSend(d, { confirmed: true, evidence: "   " }).ok).toBe(false);
    expect(reviewSend(d, { confirmed: false, evidence: "Sent folder message 42" }).ok).toBe(false);
    expect(d.sent_at).toBeNull();
  });

  it("recording a send with confirmation and evidence is accepted and names the audit action", () => {
    const decision = reviewSend(draft(), { confirmed: true, evidence: "Sent folder message 42" });
    expect(decision).toEqual({
      ok: true,
      evidence: "Sent folder message 42",
      outcomeUnknown: false,
    });
    expect(EXTERNAL_SEND_AUDIT_ACTION).toBe("External send recorded by human");
  });

  it("sentAt cannot be constructed without sentEvidence", () => {
    expect(() => draft({ sent_at: NOW.toISOString(), sent_evidence: null })).toThrow();
    expect(() => draft({ sent_at: null, sent_evidence: "x" })).toThrow();
    expect(
      draft({ sent_at: NOW.toISOString(), sent_evidence: "Sent folder message 42" }).sent_at,
    ).toBe(NOW.toISOString());
  });

  it("an unknown send outcome disables retry until an outcome check runs", () => {
    const unknown = draft({
      sent_at: NOW.toISOString(),
      sent_evidence: "Sent folder message 42",
      outcome_unknown: true,
    });
    expect(canRetry(unknown)).toBe(false);
    expect(canRetry({ ...unknown, outcome_unknown: false })).toBe(true);
    expect(reviewSend(unknown, { confirmed: true, evidence: "again" }).ok).toBe(false);
  });
});
