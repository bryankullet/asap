import { describe, expect, it } from "vitest";
import {
  ASK_ALLOWED_VERBS,
  Action,
  ActionVerb,
  GuardId,
  GuardRef,
  isAskAllowed,
} from "./actions.js";

describe("action vocabulary", () => {
  it("is exactly the ten verbs of Part 5.2, in the spec's order", () => {
    expect(ActionVerb.options).toEqual([
      "prepare",
      "open",
      "draft",
      "record_send",
      "approve",
      "record_evidence",
      "resolve",
      "assign",
      "complete",
      "exception",
    ]);
  });

  it("anything else is not a button", () => {
    for (const bad of ["send", "pay", "bind", "delete", "approve_all", "Prepare"]) {
      expect(ActionVerb.safeParse(bad).success, bad).toBe(false);
      expect(Action.safeParse({ verb: bad, label: "x" }).success, bad).toBe(false);
    }
  });

  it("an action may only reference known guards and may not carry extra fields", () => {
    expect(
      Action.safeParse({ verb: "approve", label: "Approve", guards: ["version_current"] }).success,
    ).toBe(true);
    expect(
      Action.safeParse({ verb: "approve", label: "Approve", guards: ["manager_says_so"] }).success,
    ).toBe(false);
    expect(Action.safeParse({ verb: "open", label: "Open", href: "/r/1" }).success).toBe(false);
  });

  it("Ask may only prepare, open or draft", () => {
    expect([...ASK_ALLOWED_VERBS]).toEqual(["prepare", "open", "draft"]);
    for (const v of [
      "record_send",
      "approve",
      "record_evidence",
      "resolve",
      "assign",
      "complete",
      "exception",
    ] as const) {
      expect(isAskAllowed(v), v).toBe(false);
    }
  });
});

describe("guards", () => {
  it("is exactly the eleven guard ids of Part 5.3", () => {
    expect(GuardId.options).toEqual([
      "client_file_cleared",
      "authority_sufficient",
      "version_current",
      "component_declared",
      "agreed_rate_exists",
      "evidence_present",
      "no_duplicate_open",
      "certificate_unissued",
      "business_rule_exists",
      "stock_available",
      "screening_source_configured",
    ]);
  });

  it("business_rule_exists must name its rule; other guards must not", () => {
    expect(GuardRef.safeParse({ id: "business_rule_exists", rule: "tor_meaning" }).success).toBe(
      true,
    );
    expect(GuardRef.safeParse("business_rule_exists").success).toBe(false);
    expect(GuardRef.safeParse({ id: "business_rule_exists", rule: "" }).success).toBe(false);
    expect(GuardRef.safeParse({ id: "stock_available", rule: "x" }).success).toBe(false);
    expect(GuardRef.safeParse("stock_available").success).toBe(true);
    expect(
      Action.safeParse({
        verb: "prepare",
        label: "Prepare",
        guards: [{ id: "business_rule_exists", rule: "levy_rate" }],
      }).success,
    ).toBe(true);
  });
});
