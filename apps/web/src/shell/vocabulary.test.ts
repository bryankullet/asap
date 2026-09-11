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
import { JOB_FILTERS, NAV, WORK_FILTERS } from "./nav.js";

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

  it("uses the approved Work filters, in the approved order", () => {
    expect(WORK_FILTERS.map((f) => f.label)).toEqual([
      "Active",
      "Waiting",
      "For review",
      "Completed",
      "Pinned",
      "Recent",
    ]);
  });

  it("keeps Work's and Jobs' vocabularies recognisably different", () => {
    // They may share a word — the approved demo has Waiting in both — but a Job is never described
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

describe("the demo fixtures", () => {
  it("never say Space — every visible string is Work", async () => {
    const { DEMO_SCENARIOS } = await import("@asap/schema");
    for (const s of DEMO_SCENARIOS) {
      const visible = [
        s.name,
        s.ask,
        s.lead,
        s.text,
        s.panel.type,
        s.panel.title,
        s.panel.desc,
        s.panel.warning ?? "",
        ...s.suggest,
        ...s.panel.actions,
        ...s.panel.issues.flat(),
        ...s.panel.facts.flat(),
      ].join(" ");
      expect(visible, s.id).not.toMatch(/\bSpaces?\b/i);
      expect(visible.toLowerCase(), s.id).not.toContain("needs you");
    }
  });

  it("covers the approved catalogue", async () => {
    const { DEMO_SCENARIOS, DEMO_WORK, DEMO_JOBS, DEMO_AUTOMATIONS, DEMO_CLIENTS } = await import(
      "@asap/schema"
    );
    expect(DEMO_SCENARIOS).toHaveLength(32);
    expect(DEMO_WORK).toHaveLength(8);
    expect(DEMO_JOBS.length).toBeGreaterThanOrEqual(5);
    expect(DEMO_AUTOMATIONS).toHaveLength(6);
    expect(DEMO_CLIENTS.map((c) => c.id)).toEqual([
      "acme",
      "karibu",
      "bluewave",
      "greencare",
      "mara",
      "northstar",
    ]);
  });

  it("gives every Work item a scenario to open, and every job an outcome", async () => {
    const { DEMO_WORK, DEMO_JOBS, scenarioById } = await import("@asap/schema");
    for (const w of DEMO_WORK) {
      expect(scenarioById(w.scenarioId), `${w.id} → ${w.scenarioId}`).toBeDefined();
    }
    for (const j of DEMO_JOBS) {
      // Outcome language, never a business claim.
      expect(j.outcome.length).toBeGreaterThan(0);
      expect(j.outcome.toLowerCase()).not.toMatch(/policy renewed|claim accepted|money received/);
    }
  });
});
