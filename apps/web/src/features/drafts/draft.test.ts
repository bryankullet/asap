/**
 * Ported from the prototype's checks.mjs lines 20–21 (UI Build Spec v1 Part 0, Part 7):
 * "a draft without evidence stays unsent". The original: ensureDraft(record); set copiedAt;
 * sentAt is still null; open the sent-review dialog with the confirmation unchecked and evidence
 * empty; save; sentAt still null. Then check the confirmation, type "Sent folder message 42",
 * save; sentAt is set and the newest audit entry's action is "External send recorded by human".
 *
 * SKIPPED: the Draft type and the drafts feature are UI Build Spec Phase 2. Un-skip when
 * `packages/schema/src/draft.ts` and `apps/web/src/features/drafts` exist.
 */
import { describe, expect, it } from "vitest";

describe.skip("drafts — a draft without evidence stays unsent (Phase 2: Draft not built)", () => {
  it("copying sets copiedAt and sentAt stays null", () => {
    // const d = markCopied(draft, now); expect(d.copiedAt).toEqual(now); expect(d.sentAt).toBeNull();
    expect.fail("Draft not built");
  });

  it("recording a send without the confirmation and evidence leaves sentAt null", () => {
    // recordSend(d, { confirmed: false, evidence: "" }); expect(d.sentAt).toBeNull();
    expect.fail("Draft not built");
  });

  it("recording a send with confirmation and evidence sets sentAt and writes the audit action", () => {
    // recordSend(d, { confirmed: true, evidence: "Sent folder message 42" });
    // expect(d.sentAt).toBeTruthy();
    // expect(audit[0].action).toBe("External send recorded by human");
    expect.fail("Draft not built");
  });

  it("sentAt cannot be constructed without sentEvidence", () => {
    // expect(() => Draft.parse({ ...draft, sentAt: now })).toThrow();
    expect.fail("Draft not built");
  });

  it("an unknown send outcome disables retry until an outcome check runs", () => {
    expect.fail("Draft not built");
  });
});
