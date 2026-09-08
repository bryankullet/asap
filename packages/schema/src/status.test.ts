/**
 * Ported from the prototype's "no shared status word" test (UI Build Spec v1, Part 0 and 2.2),
 * adapted to the typed enums.
 */
import { describe, expect, it } from "vitest";
import {
  BANNED_STRINGS,
  COVER_LABELS,
  CoverStatus,
  FILE_LABELS,
  FileStatus,
  LABELS_BY_LAYER,
  MONEY_LABELS,
  MoneyStatus,
  RUN_LABELS,
  RunStatus,
  STATUS_LAYERS,
  STOCK_LABELS,
  StockStatus,
  TASK_LABELS,
  TaskStatus,
  bannedStringsFor,
  containsBannedString,
  taskLabel,
  WITH_PARTY_ERROR,
} from "./status.js";

const allLabels = [
  ...Object.values(TASK_LABELS),
  ...Object.values(RUN_LABELS),
  ...Object.values(COVER_LABELS),
  ...Object.values(MONEY_LABELS),
  ...Object.values(FILE_LABELS),
  ...Object.values(STOCK_LABELS),
];

describe("status layers", () => {
  it("no label appears in two layers", () => {
    expect(new Set(allLabels).size).toBe(allLabels.length);
  });

  it("no label appears in two layers, case-insensitively", () => {
    const lower = allLabels.map((l) => l.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("every enum value has exactly one label and no label is empty", () => {
    const pairs: [readonly string[], Readonly<Record<string, string>>][] = [
      [TaskStatus.options, TASK_LABELS],
      [RunStatus.options, RUN_LABELS],
      [CoverStatus.options, COVER_LABELS],
      [MoneyStatus.options, MONEY_LABELS],
      [FileStatus.options, FILE_LABELS],
      [StockStatus.options, STOCK_LABELS],
    ];
    for (const [options, labels] of pairs) {
      expect(Object.keys(labels).sort()).toEqual([...options].sort());
      for (const label of Object.values(labels)) expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("the enums are exactly the spec's six vocabularies", () => {
    expect(TaskStatus.options).toEqual(["needs_you", "with_party", "in_progress", "done"]);
    expect(RunStatus.options).toEqual([
      "working",
      "paused",
      "finished",
      "could_not_finish",
      "stopped",
    ]);
    expect(CoverStatus.options).toEqual([
      "draft",
      "requested",
      "submitted",
      "confirmed",
      "active",
      "expired",
      "cancelled",
    ]);
    expect(MoneyStatus.options).toEqual([
      "not_invoiced",
      "unpaid",
      "part_paid",
      "paid",
      "received",
      "reconciled",
      "disputed",
      "due_to_insurer",
      "settled",
    ]);
    expect(FileStatus.options).toEqual([
      "not_started",
      "incomplete",
      "in_review",
      "cleared",
      "refresh_due",
    ]);
    expect(StockStatus.options).toEqual(["allocated", "issued", "voided", "unaccounted"]);
  });
});

describe("taskLabel (prototype checks.mjs lines 16, 17, 22)", () => {
  it("renders a with_party task as With <party>", () => {
    expect(taskLabel({ status: "with_party", party: "Jubilee", since: "2026-09-03" })).toBe(
      "With Jubilee",
    );
    expect(taskLabel({ status: "needs_you" })).toBe("Needs you");
  });

  it("the prototype's rendered task group shares no word with the other layers", () => {
    const groups = [
      ["Needs you", "With Jubilee", "In progress", "Completed"],
      Object.values(RUN_LABELS),
      Object.values(COVER_LABELS),
      Object.values(MONEY_LABELS),
      Object.values(FILE_LABELS),
      Object.values(STOCK_LABELS),
    ];
    expect(new Set(groups.flat()).size).toBe(groups.flat().length);
  });

  it("refuses with_party without a party and a since date, with the prototype's message", () => {
    expect(() => taskLabel({ status: "with_party" })).toThrow(WITH_PARTY_ERROR);
    expect(() => taskLabel({ status: "with_party", party: "Jubilee" })).toThrow(WITH_PARTY_ERROR);
    expect(() => taskLabel({ status: "with_party", since: "2026-09-03" })).toThrow(
      WITH_PARTY_ERROR,
    );
  });
});

describe("banned strings", () => {
  it("lists exactly the spec's six words", () => {
    expect([...BANNED_STRINGS]).toEqual([
      "Waiting",
      "Failed",
      "Success",
      "Space",
      "Job",
      "Completed",
    ]);
  });

  it("no label in any non-task layer contains a banned word", () => {
    for (const layer of STATUS_LAYERS) {
      if (layer === "task") continue;
      for (const label of Object.values(LABELS_BY_LAYER[layer])) {
        expect(containsBannedString(label, layer), `${layer}: "${label}"`).toBe(false);
      }
    }
  });

  it("task labels may say Completed but nothing else on the list", () => {
    expect(bannedStringsFor("task")).not.toContain("Completed");
    for (const label of Object.values(TASK_LABELS)) {
      expect(containsBannedString(label, "task"), `task: "${label}"`).toBe(false);
    }
    expect(containsBannedString("Completed", "any")).toBe(true);
    expect(containsBannedString("Completed", "task")).toBe(false);
  });

  it("matches whole words only", () => {
    expect(containsBannedString("Workspace")).toBe(false);
    expect(containsBannedString("Jobs")).toBe(false);
    expect(containsBannedString("Job")).toBe(true);
    expect(containsBannedString("The run Failed")).toBe(true);
  });
});
