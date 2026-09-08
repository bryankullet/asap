/**
 * Ported from the prototype: "a draft without evidence stays unsent" (UI Build Spec v1, Part 0,
 * Part 7). `copiedAt` advances nothing; `sentAt` may only be set together with `sentEvidence`.
 * Any code path that sets `sentAt` without evidence is a defect.
 *
 * SKIPPED: the Draft type and the draft feature do not exist yet (Part 7 ships in Phase 2).
 * The assertions are the contract; un-skip when `packages/schema/src/draft.ts` and
 * `apps/web/src/features/drafts` exist.
 */
import { describe, expect, it } from "vitest";

describe.skip("drafts — a draft without evidence stays unsent (Phase 2: Draft not built)", () => {
  it("copying sets copiedAt and changes nothing else", () => {
    // const d = markCopied(draft, now); expect(d.copiedAt).toEqual(now); expect(d.sentAt).toBeUndefined();
    expect.fail("Draft not built");
  });

  it("sentAt cannot be set without sentEvidence", () => {
    // expect(() => Draft.parse({ ...draft, sentAt: now })).toThrow();
    // expect(Draft.parse({ ...draft, sentAt: now, sentEvidence: "msg-id-123" }).sentAt).toEqual(now);
    expect.fail("Draft not built");
  });

  it("an unknown send outcome disables retry until an outcome check runs", () => {
    expect.fail("Draft not built");
  });
});
