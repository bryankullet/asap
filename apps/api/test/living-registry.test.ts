/**
 * Migrations 0079 and 0081 register the Living blocks (D-156). Like 0031's suite, this reads what shipped
 * and asserts it equals the Zod source in packages/schema/src/living.ts, so the two copies of one
 * contract cannot drift without a test failing.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readdirSync } from "node:fs";
const DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
// Every migration that registers Living blocks (0079, 0081, …), read as shipped.
const sql = readdirSync(DIR).filter((f) => /_living_/.test(f)).sort().map((f) => readFileSync(DIR + f, "utf8")).join("\n");
const re = /\('([A-Za-z]+)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)',\s*array\[([^\]]*)\]::text\[\],\s*array\[([^\]]*)\]::text\[\],\s*(true|false), (true|false),\s*'((?:[^']|'')*)'::jsonb\)/g;
const rows = [...sql.matchAll(re)].map((m) => ({
  id: m[1]! as LivingComponent,
  version: Number(m[2]),
  name: m[3]!.replace(/''/g, "'"),
  spaces: m[5]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean),
  requiresEvidence: m[8] === "true",
  schema: JSON.parse(m[9]!.replace(/''/g, "'")),
}));

// A component's current version is its latest row; earlier versions stay registered, never deleted.
const latest = [...new Set(rows.map((r) => r.id))].map((id) => rows.filter((r) => r.id === id).reduce((a, b) => (b.version > a.version ? b : a)));

describe("the Living block registry", () => {
  it("registers exactly the Living components", () => {
    expect(latest.map((r) => r.id).sort()).toEqual(Object.keys(LIVING_BLOCK_PROPS).sort());
  });
  it("keeps every earlier version of a component registered, numbered from 1", () => {
    for (const id of new Set(rows.map((r) => r.id))) expect(rows.filter((r) => r.id === id).map((r) => r.version).sort(), id).toEqual(Array.from({ length: LIVING_REGISTRY[id].version }, (_, i) => i + 1));
  });
  it("stores the same property schema the composer builds with", () => {
    for (const r of latest) expect(r.schema, r.id).toEqual(livingPropsJsonSchema(r.id));
  });
  it("matches the code's registry metadata and allows only Living surfaces", () => {
    for (const r of latest) {
      expect(r.version, r.id).toBe(LIVING_REGISTRY[r.id].version);
      expect(r.name, r.id).toBe(LIVING_REGISTRY[r.id].name);
      expect(r.requiresEvidence, r.id).toBe(LIVING_REGISTRY[r.id].requiresEvidence);
      expect(r.spaces, r.id).toEqual(["living"]);
    }
  });
});
