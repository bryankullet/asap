/**
 * Migration 0031 seeds `component_definitions`, and the API validates plans against the JSON
 * Schema stored there (D-059: the registry is authoritative). The same shapes exist in code as
 * Zod, in packages/schema/src/spaces/blocks.ts, because that is what builds and types the plans.
 *
 * Two copies of one contract drift. This suite reads the migration and asserts they are equal, so
 * a change to either side without the other fails here rather than in a browser.
 */
import { RENEWAL_SPACE_BLOCK_PROPS, ComponentId, propsJsonSchema } from "@asap/schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260910120000_0031_component_definitions.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(MIGRATION, "utf8");

/** The seeded rows, parsed out of the INSERT. Deliberately literal: it reads what shipped. */
function seededRows(): {
  id: string;
  name: string;
  spaces: string[];
  permissions: string[];
  canContainAction: boolean;
  requiresEvidence: boolean;
  schema: unknown;
}[] {
  const values = sql.slice(sql.indexOf("values\n") + 7);
  const rows: ReturnType<typeof seededRows> = [];
  // Each row starts with ('ComponentId', 1, ... and ends with a ::jsonb literal.
  const re =
    /\('([A-Za-z]+)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)',\s*array\[([^\]]*)\]::text\[\],\s*array\[([^\]]*)\]::text\[\],\s*(true|false), (true|false),\s*'((?:[^']|'')*)'::jsonb\)/g;
  for (const m of values.matchAll(re)) {
    rows.push({
      id: m[1]!,
      name: m[3]!.replace(/''/g, "'"),
      spaces: m[5]!
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter((s) => s.length > 0),
      permissions: m[6]!
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter((s) => s.length > 0),
      canContainAction: m[7] === "true",
      requiresEvidence: m[8] === "true",
      schema: JSON.parse(m[9]!.replace(/''/g, "'")),
    });
  }
  return rows;
}

const rows = seededRows();

describe("the seeded component registry", () => {
  it("seeds exactly the components the first Renewal Space uses, and nothing else", () => {
    const expected = Object.keys(RENEWAL_SPACE_BLOCK_PROPS).sort();
    expect(rows.map((r) => r.id).sort()).toEqual(expected);
    expect(rows).toHaveLength(9);
  });

  it("stores the same property schema the code builds plans with", () => {
    for (const row of rows) {
      const fromCode = propsJsonSchema(row.id as keyof typeof RENEWAL_SPACE_BLOCK_PROPS);
      expect(row.schema, `${row.id} props_schema`).toEqual(fromCode);
    }
  });

  it("names only components that exist in the library", () => {
    for (const row of rows) expect(ComponentId.safeParse(row.id).success, row.id).toBe(true);
  });

  it("allows every component in the renewal Space, since that is the one being composed", () => {
    for (const row of rows) expect(row.spaces, row.id).toContain("renewal");
  });

  it("lets only the focus block and the draft carry an action", () => {
    const withAction = rows.filter((r) => r.canContainAction).map((r) => r.id);
    expect(withAction.sort()).toEqual(["DraftEmail", "RenewalReadiness"]);
  });

  it("requires evidence on every component that displays a business fact", () => {
    const needsEvidence = rows.filter((r) => r.requiresEvidence).map((r) => r.id).sort();
    expect(needsEvidence).toEqual([
      "InsurerResponseTracker",
      "PolicyCard",
      "SourceEvidence",
      "TermComparison",
    ]);
  });

  it("closes every property schema, so an extra key is a rejection", () => {
    for (const row of rows) {
      const schema = row.schema as { additionalProperties?: unknown };
      expect(schema.additionalProperties, `${row.id} must be closed`).toBe(false);
    }
  });
});

describe("the migration itself", () => {
  it("enables row level security and grants no write path", () => {
    expect(sql).toMatch(/alter table component_definitions enable row level security/);
    expect(sql).toMatch(/create policy component_definitions_read on component_definitions/);
    // A component arrives by migration, reviewed. No role writes one through the data API.
    expect(sql).not.toMatch(/for (insert|update|delete) to authenticated/);
    expect(sql).toMatch(/revoke insert, update, delete on component_definitions/);
  });

  it("versions every row, so a Space rendered today still renders later", () => {
    expect(sql).toMatch(/primary key \(component_id, version\)/);
    expect(sql).toMatch(/version\s+integer not null check \(version >= 1\)/);
  });
});
