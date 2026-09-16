/**
 * The retired vocabulary, kept retired (D-064).
 *
 * "Needs you" and a visible "Space" are gone from the product. This walks the label maps and the
 * shell's own words so that reintroducing either fails a test rather than reaching a broker.
 */
import {
  ATTENTION_SECTION_LABELS,
  COVER_LABELS,
  EVIDENCE_CONDITION_LABELS,
  FILE_LABELS,
  MONEY_LABELS,
  RUN_LABELS,
  TASK_LABELS,
  WORK_VIEW_LABELS,
  containsBannedString,
} from "@asap/schema";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_FILTER,
  JOB_FILTERS,
  NAV,
  PINNED_VIEW,
  REVIEW_VIEW,
  WORK_FILTERS,
} from "./nav.js";

const EVERY_VISIBLE_LABEL = [
  ...Object.values(TASK_LABELS),
  ...Object.values(WORK_VIEW_LABELS),
  ...Object.values(ATTENTION_SECTION_LABELS),
  ...Object.values(COVER_LABELS),
  ...Object.values(MONEY_LABELS),
  ...Object.values(FILE_LABELS),
  ...Object.values(RUN_LABELS),
  ...Object.values(EVIDENCE_CONDITION_LABELS),
  ...NAV.map((n) => n.label),
  ...WORK_FILTERS.map((f) => f.label),
  PINNED_VIEW.label,
  REVIEW_VIEW.label,
  ...JOB_FILTERS.map((f) => f.label),
];

describe("the product's visible vocabulary", () => {
  it("never says 'Needs you'", () => {
    for (const label of EVERY_VISIBLE_LABEL) {
      expect(label.toLowerCase(), label).not.toContain("needs you");
    }
  });

  it("never says 'Space' — it is called Work on screen", () => {
    for (const label of EVERY_VISIBLE_LABEL) {
      expect(label, label).not.toMatch(/\bSpaces?\b/);
    }
  });

  it("uses the approved Work views, in the approved order (D-075)", () => {
    expect(WORK_FILTERS.map((f) => f.label)).toEqual([
      "Your work",
      "With others",
      "In progress",
      "Done",
      "Recent",
    ]);
  });

  it("keeps Pinned and For review out of the main views (D-075)", () => {
    // A personal marker is not a state work is in, and "For review" is not the name for all
    // human work — it appears where review is genuinely the question.
    const main = WORK_FILTERS.map((f) => f.label);
    expect(main).not.toContain("Pinned");
    expect(main).not.toContain("For review");
    expect(PINNED_VIEW.label).toBe("Pinned");
    expect(REVIEW_VIEW.label).toBe("For review");
  });

  it("opens on Your work", () => {
    expect(DEFAULT_WORK_FILTER).toBe("needs");
    expect(WORK_FILTERS[0]?.id).toBe(DEFAULT_WORK_FILTER);
  });

  it("uses the API's own view names, so a label cannot drift from its query", () => {
    for (const f of WORK_FILTERS) {
      expect(WORK_VIEW_LABELS[f.id], f.id).toBe(f.label);
    }
  });

  it("never says a bare 'Waiting' — it names the party instead (D-074)", () => {
    // "Waiting on someone else" is allowed and "With APA since 15 Sep" is the card's own wording.
    // What is banned is the word alone, which tells a person nothing they can act on.
    for (const label of EVERY_VISIBLE_LABEL) {
      expect(label.trim(), label).not.toBe("Waiting");
    }
  });

  it("keeps Ask ASAP and Jobs out of the destinations (D-074)", () => {
    expect(NAV.map((n) => n.label)).toEqual(["Today", "Work", "Automations"]);
  });

  it("keeps Work's and Jobs' vocabularies recognisably different", () => {
    // A job is never described
    // with Work's decision language, and Work is never described with a run's.
    expect(JOB_FILTERS.map((f) => f.label)).not.toContain("For review");
    expect(WORK_FILTERS.map((f) => f.label)).not.toContain("Running");
    expect(WORK_FILTERS.map((f) => f.label)).not.toContain("Failed");
  });

  it("still refuses the retired words through the shared checker", () => {
    expect(containsBannedString("Needs you")).toBe(true);
    expect(containsBannedString("Renewal Space")).toBe(true);
  });
});
