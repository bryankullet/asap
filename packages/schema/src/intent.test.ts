import { describe, expect, it } from "vitest";
import { AskComponentId, ComponentId, UiIntent, uiIntentJsonSchema } from "./intent.js";

type JsonSchema = { [key: string]: unknown };

/** Every object schema reachable from the root, wherever it sits. */
function objectSchemas(node: unknown, path = "$"): [string, JsonSchema][] {
  if (typeof node !== "object" || node === null) return [];
  const out: [string, JsonSchema][] = [];
  const obj = node as JsonSchema;
  const type = obj["type"];
  if (type === "object" || (Array.isArray(type) && type.includes("object"))) out.push([path, obj]);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v))
      v.forEach((item, i) => out.push(...objectSchemas(item, `${path}.${k}[${i}]`)));
    else if (typeof v === "object" && v !== null) out.push(...objectSchemas(v, `${path}.${k}`));
  }
  return out;
}

describe("UiIntent JSON schema", () => {
  it("has additionalProperties false at every object level", () => {
    const objects = objectSchemas(uiIntentJsonSchema);
    expect(objects.length).toBeGreaterThan(0);
    for (const [path, schema] of objects) {
      expect(schema["additionalProperties"], `${path} must forbid additional properties`).toBe(
        false,
      );
    }
  });

  it("requires every field, so the model cannot omit view or suggestions", () => {
    expect(uiIntentJsonSchema["required"]).toEqual([
      "type",
      "target",
      "panel",
      "view",
      "answer",
      "suggestions",
    ]);
  });

  it("constrains type, view and panel to closed enums and suggestions to four", () => {
    const props = uiIntentJsonSchema["properties"] as Record<string, JsonSchema>;
    expect(props["type"]!["enum"]).toEqual([
      "answer",
      "open_record",
      "work_list",
      "draft",
      "automation",
      "panel",
    ]);
    expect(props["view"]!["enum"]).toEqual([
      "summary",
      "blocker",
      "comparison",
      // Added with the first Renewal Space (D-059): "show me the current policy" changes the
      // blocks while keeping the client's context, and there was no view for it.
      "policy",
      "money",
      "documents",
      "timeline",
    ]);
    expect(props["suggestions"]!["maxItems"]).toBe(4);
    const panel = props["panel"]!;
    const panelEnum = (panel["enum"] ??
      (panel["anyOf"] as JsonSchema[] | undefined)?.find((s) => s["enum"])?.["enum"]) as
      string[] | undefined;
    expect(panelEnum).toBeDefined();
    expect(panelEnum).toEqual(expect.arrayContaining(AskComponentId.options));
  });
});

describe("UiIntent parsing", () => {
  const valid = {
    type: "open_record",
    target: "pol_991",
    panel: "PolicyCard",
    view: "summary",
    answer: "Opening the policy.",
    suggestions: ["Show the schedule"],
  };

  it("accepts the spec's shape", () => {
    expect(UiIntent.parse(valid)).toEqual(valid);
  });

  it("rejects markup-bearing extras, unknown components and more than four suggestions", () => {
    expect(UiIntent.safeParse({ ...valid, html: "<div/>" }).success).toBe(false);
    expect(UiIntent.safeParse({ ...valid, panel: "RawHtml" }).success).toBe(false);
    expect(UiIntent.safeParse({ ...valid, suggestions: ["a", "b", "c", "d", "e"] }).success).toBe(
      false,
    );
  });
});

describe("component registry (D-041)", () => {
  it("AskComponentId is a strict subset of ComponentId", () => {
    const all = new Set<string>(ComponentId.options);
    for (const id of AskComponentId.options) expect(all.has(id), id).toBe(true);
    expect(AskComponentId.options.length).toBeLessThan(ComponentId.options.length);
  });

  it("Ask may not return shell, state, run or v3-surface components", () => {
    const ask = new Set<string>(AskComponentId.options);
    for (const id of [
      "AppShell",
      "AskComposer",
      "EmptyState",
      "PermissionNotice",
      "JobProgress",
      "StepOutcome",
      "PremiumBreakdown",
      "ClientFileStatus",
      "DueDiligenceChecklist",
      "ScreeningMatchReview",
      "AgreementCard",
      "RateTable",
      "CertificateStockTable",
      "CertificateCard",
      "UnidentifiedReceiptsTable",
      "InsurerAccountSummary",
      "SettlementRunTable",
      "TaxCertificateTable",
    ]) {
      expect(ComponentId.options).toContain(id);
      expect(ask.has(id), id).toBe(false);
    }
    expect(
      UiIntent.safeParse({
        type: "panel",
        target: null,
        panel: "AppShell",
        view: "summary",
        answer: "",
        suggestions: [],
      }).success,
    ).toBe(false);
  });

  it("has no duplicate ids", () => {
    expect(new Set(ComponentId.options).size).toBe(ComponentId.options.length);
  });
});
