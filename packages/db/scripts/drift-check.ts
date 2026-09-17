/**
 * Drift check: the Drizzle schema in src/schema must agree with the migrated database.
 *
 * Compares, for every public table:
 *   - the set of tables (both directions)
 *   - the set of columns (both directions)
 *   - data type, nullability and presence of a default per column
 *   - that RLS is enabled on every table (a table without it is reachable through PostgREST)
 *
 * Runs against DATABASE_URL after `supabase db reset` (CI) or scripts/db-verify-local.sh.
 * Exits non-zero on any difference and prints every difference, not just the first.
 */
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "../src/schema/index.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("drift-check: DATABASE_URL is not set");
  process.exit(2);
}

type DbColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
  numeric_precision: number | null;
  numeric_scale: number | null;
  character_maximum_length: number | null;
};

/** Drizzle's getSQLType() → information_schema.data_type */
function normaliseDrizzleType(t: string): string {
  const lower = t.toLowerCase();
  if (lower.startsWith("timestamp") && lower.includes("with time zone")) {
    return "timestamp with time zone";
  }
  if (lower === "timestamp") return "timestamp without time zone";
  return lower;
}

/**
 * Why the type comparison is not a string equality.
 *
 * `information_schema.columns.data_type` does not spell a type the way Drizzle does. An array of
 * any element type reads as the bare word `ARRAY`, with the element in `udt_name` as `_text`; and
 * a `numeric(14,2)` reads as `numeric`, with the precision and scale in their own columns. Drizzle
 * writes both in full — `text[]`, `numeric(14, 2)` — so comparing the two strings would report a
 * difference on every array and every money column while the database and the schema agree.
 *
 * So the comparison is taken apart instead, and it is stricter than it was: the element type of an
 * array and the precision and scale of a numeric are now checked, where before neither could be
 * expressed at all.
 */
function typeProblem(want: string, db: DbColumn): string | null {
  const wanted = want.trim();
  const arrayWanted = wanted.endsWith("[]");

  if (db.data_type === "ARRAY") {
    if (!arrayWanted) return `type ${db.udt_name.replace(/^_/, "")}[] in database, ${wanted} in Drizzle`;
    const element = db.udt_name.replace(/^_/, "");
    const wantedElement = wanted.slice(0, -2);
    // udt_name uses internal spellings (`_int4`, `_bool`); accept either name for the element.
    const aliases: Record<string, string[]> = {
      int4: ["integer", "int", "int4"],
      int8: ["bigint", "int8"],
      bool: ["boolean", "bool"],
      float8: ["double precision", "float8"],
      timestamptz: ["timestamp with time zone", "timestamptz"],
    };
    const accepted = aliases[element] ?? [element];
    if (!accepted.includes(wantedElement)) {
      return `array of ${element} in database, array of ${wantedElement} in Drizzle`;
    }
    return null;
  }
  if (arrayWanted) return `${db.data_type} in database, ${wanted} in Drizzle`;

  const match = /^([a-z ]+?)\s*\(([^)]*)\)$/.exec(wanted);
  const base = (match?.[1] ?? wanted).trim();
  if (base !== db.data_type) return `type ${db.data_type} in database, ${base} in Drizzle`;

  const args = (match?.[2] ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (base === "numeric") {
    const wantPrecision = args[0] === undefined ? null : Number(args[0]);
    const wantScale = args[1] === undefined ? (args[0] === undefined ? null : 0) : Number(args[1]);
    if (wantPrecision !== db.numeric_precision || wantScale !== db.numeric_scale) {
      const shown = (p: number | null, s: number | null) => (p === null ? "numeric" : `numeric(${p},${s ?? 0})`);
      return `type ${shown(db.numeric_precision, db.numeric_scale)} in database, ${shown(wantPrecision, wantScale)} in Drizzle`;
    }
  }
  if ((base === "character varying" || base === "character") && args[0] !== undefined) {
    if (Number(args[0]) !== db.character_maximum_length) {
      return `length ${db.character_maximum_length} in database, ${args[0]} in Drizzle`;
    }
  }
  return null;
}

async function main() {
  const sql = postgres(url as string, { max: 1, prepare: false });
  const problems: string[] = [];

  try {
    const dbColumns = await sql<DbColumn[]>`
      select table_name, column_name, data_type, udt_name, is_nullable, column_default,
             is_identity, numeric_precision, numeric_scale, character_maximum_length
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`;

    const dbTables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;

    const drizzleTables = (Object.values(schema) as unknown[]).filter(
      (v): v is PgTable => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v,
    );
    const drizzleByName = new Map(drizzleTables.map((t) => [getTableConfig(t).name, t]));

    for (const { relname, relrowsecurity } of dbTables) {
      if (!drizzleByName.has(relname)) {
        problems.push(`table ${relname}: exists in database, missing from Drizzle schema`);
      }
      if (!relrowsecurity) {
        problems.push(`table ${relname}: row level security is not enabled`);
      }
    }
    for (const name of drizzleByName.keys()) {
      if (!dbTables.some((t) => t.relname === name)) {
        problems.push(`table ${name}: exists in Drizzle schema, missing from database`);
      }
    }

    for (const [tableName, table] of drizzleByName) {
      const cfg = getTableConfig(table);
      const dbCols = dbColumns.filter((c) => c.table_name === tableName);
      if (dbCols.length === 0) continue;

      const dbByName = new Map(dbCols.map((c) => [c.column_name, c]));
      for (const col of cfg.columns) {
        const db = dbByName.get(col.name);
        if (!db) {
          problems.push(`${tableName}.${col.name}: in Drizzle, missing from database`);
          continue;
        }
        const mismatch = typeProblem(normaliseDrizzleType(col.getSQLType()), db);
        if (mismatch !== null) problems.push(`${tableName}.${col.name}: ${mismatch}`);
        const dbNotNull = db.is_nullable === "NO";
        if (col.notNull !== dbNotNull) {
          problems.push(
            `${tableName}.${col.name}: ${dbNotNull ? "not null" : "nullable"} in database, ${col.notNull ? "not null" : "nullable"} in Drizzle`,
          );
        }
        const dbHasDefault = db.column_default !== null || db.is_identity === "YES";
        const drizzleHasDefault = col.hasDefault || col.generatedIdentity !== undefined;
        if (dbHasDefault !== drizzleHasDefault) {
          problems.push(
            `${tableName}.${col.name}: default ${dbHasDefault ? "present" : "absent"} in database, ${drizzleHasDefault ? "present" : "absent"} in Drizzle`,
          );
        }
      }
      for (const c of dbCols) {
        if (!cfg.columns.some((col) => col.name === c.column_name)) {
          problems.push(`${tableName}.${c.column_name}: in database, missing from Drizzle`);
        }
      }
    }
  } finally {
    await sql.end();
  }

  if (problems.length > 0) {
    console.error(
      `drift-check: ${problems.length} difference(s) between Drizzle and the database:`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("drift-check: Drizzle schema and database agree");
}

main().catch((err: unknown) => {
  console.error("drift-check: failed", err instanceof Error ? err.message : err);
  process.exit(2);
});
