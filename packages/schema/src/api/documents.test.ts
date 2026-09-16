/**
 * The state a person is told, and the one rule that matters most: **uploading is not reading.**
 */
import { describe, expect, it } from "vitest";
import { READING_STATE_LABELS, readingStatus, type DocumentField } from "./documents.js";

const field = (
  state: DocumentField["state"],
  condition: DocumentField["condition"],
): Pick<DocumentField, "state" | "condition"> => ({ state, condition });

describe("readingStatus", () => {
  it("never calls an unread upload read", () => {
    const s = readingStatus({ extractionState: "not_started", fields: [] });
    expect(s.state).toBe("uploaded");
    expect(s.label).toBe("Uploaded");
    expect(s.retryable).toBe(false);
  });

  it("walks the machine's own states", () => {
    expect(readingStatus({ extractionState: "queued", fields: [] }).label).toBe("Queued");
    expect(readingStatus({ extractionState: "working", fields: [] }).label).toBe("Reading");
    expect(readingStatus({ extractionState: "not_applicable", fields: [] }).label).toBe("Not read");
  });

  it("offers a retry from failure, and from nowhere else", () => {
    expect(readingStatus({ extractionState: "failed", fields: [] }).retryable).toBe(true);
    for (const state of ["not_started", "queued", "working", "extracted", "not_applicable"] as const) {
      expect(readingStatus({ extractionState: state, fields: [] }).retryable, state).toBe(false);
    }
  });

  it("puts a conflict ahead of a gap, and a gap ahead of ready", () => {
    const conflict = readingStatus({
      extractionState: "extracted",
      fields: [field("proposed", "conflicting"), field("proposed", "missing"), field("proposed", "known")],
    });
    expect(conflict.state).toBe("conflict_found");

    const gap = readingStatus({
      extractionState: "extracted",
      fields: [field("proposed", "missing"), field("proposed", "known")],
    });
    expect(gap.state).toBe("missing_information");

    const ready = readingStatus({
      extractionState: "extracted",
      fields: [field("proposed", "known"), field("proposed", "inferred")],
    });
    expect(ready.state).toBe("ready_for_review");
  });

  it("says missing information when the document gave nothing at all", () => {
    expect(readingStatus({ extractionState: "extracted", fields: [] }).state).toBe(
      "missing_information",
    );
  });

  it("counts only what nobody has decided, and is reviewed when that reaches zero", () => {
    const partly = readingStatus({
      extractionState: "extracted",
      fields: [field("accepted", "known"), field("proposed", "known")],
    });
    expect(partly.awaiting).toBe(1);
    expect(partly.state).toBe("ready_for_review");

    const all = readingStatus({
      extractionState: "extracted",
      fields: [field("accepted", "known"), field("corrected", "known"), field("rejected", "missing")],
    });
    expect(all.awaiting).toBe(0);
    expect(all.state).toBe("reviewed");
  });

  it("stops describing a decided gap as a gap", () => {
    // A rejected field is `missing` by design — nothing is known. Once a person has said so, the
    // document is not still asking them about it.
    const s = readingStatus({
      extractionState: "extracted",
      fields: [field("rejected", "missing"), field("accepted", "known")],
    });
    expect(s.state).toBe("reviewed");
  });

  it("has a label for every state", () => {
    for (const [state, label] of Object.entries(READING_STATE_LABELS)) {
      expect(label.trim().length, state).toBeGreaterThan(0);
    }
  });
});
