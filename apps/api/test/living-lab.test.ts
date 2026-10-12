/**
 * The UI Lab's surfaces (D-156) are the composer's own output for one fictional renewal at every
 * stage, committed beside the lab page (apps/web/e2e/living-lab.json) so the browser renders exactly
 * what the server would send. This test fails if the composer changes without the snapshot; refresh
 * it with UPDATE_LIVING_LAB=1. Every surface also passes the validator.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeRenewalSurface } from "../src/living/renewal.js";
import { validateSurface } from "../src/living/validate.js";
import { labScenarios, NOW } from "./fixtures/living-facts.js";

const FILE = fileURLToPath(new URL("../../web/e2e/living-lab.json", import.meta.url));
const definitions = (Object.keys(LIVING_BLOCK_PROPS) as LivingComponent[]).map((c) => ({
  component_id: c, version: LIVING_REGISTRY[c].version, allowed_spaces: ["living"], required_permissions: [],
  can_contain_action: true, requires_evidence: LIVING_REGISTRY[c].requiresEvidence, props_schema: livingPropsJsonSchema(c), deprecated_at: null,
}));

describe("the UI Lab snapshot", () => {
  const composed = labScenarios().map((s) => ({ key: s.key, label: s.label, surface: composeRenewalSurface(s.facts, { now: NOW, aiAvailable: false }) }));
  it("covers every stage, each surface valid", () => {
    expect(composed.map((c) => c.surface.stage.key)).toEqual(["preparing", "awaiting_terms", "comparing", "placing", "placing", "issuing", "verified", "stopped"]);
    for (const c of composed) {
      const r = validateSurface({ surface: c.surface, definitions, permissions: new Set() });
      expect(r.ok ? [] : r.failures, c.key).toEqual([]);
    }
  });
  it("is what the composer produces", () => {
    const text = `${JSON.stringify(composed, null, 1)}\n`;
    if (process.env["UPDATE_LIVING_LAB"]) writeFileSync(FILE, text);
    expect(readFileSync(FILE, "utf8")).toBe(text);
  });
});
