/**
 * Migration 0079 registers the Living blocks (D-156). Like 0031's suite, this reads what shipped
 * and asserts it equals the Zod source in packages/schema/src/living.ts, so the two copies of one
 * contract cannot drift without a test failing.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20261022100000_0079_living_blocks.sql", import.meta.url)), "utf8");
const re = /\('([A-Za-z]+)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)',\s*array\[([^\]]*)\]::text\[\],\s*array\[([^\]]*)\]::text\[\],\s*(true|false), (true|false),\s*'((?:[^']|'')*)'::jsonb\)/g;
const rows = [...sql.slice(sql.indexOf("values\n")).matchAll(re)].map((m) => ({
  id: m[1]! as LivingComponent,
  version: Number(m[2]),
  name: m[3]!.replace(/''/g, "'"),
  spaces: m[5]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean),
  requiresEvidence: m[8] === "true",
  schema: JSON.parse(m[9]!.replace(/''/g, "'")),
}));

describe("the Living block registry", () => {
  it("registers exactly the Living components", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(LIVING_BLOCK_PROPS).sort());
  });
  it("stores the same property schema the composer builds with", () => {
    for (const r of rows) expect(r.schema, r.id).toEqual(livingPropsJsonSchema(r.id));
  });
  it("matches the code's registry metadata and allows only Living surfaces", () => {
    for (const r of rows) {
      expect(r.version, r.id).toBe(LIVING_REGISTRY[r.id].version);
      expect(r.name, r.id).toBe(LIVING_REGISTRY[r.id].name);
      expect(r.requiresEvidence, r.id).toBe(LIVING_REGISTRY[r.id].requiresEvidence);
      expect(r.spaces, r.id).toEqual(["living"]);
    }
  });
});
