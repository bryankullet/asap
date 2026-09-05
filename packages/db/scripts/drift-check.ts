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
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
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

async function main() {
  const sql = postgres(url as string, { max: 1, prepare: false });
  const problems: string[] = [];

  try {
    const dbColumns = await sql<DbColumn[]>`
      select table_name, column_name, data_type, is_nullable, column_default, is_identity
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
        const want = normaliseDrizzleType(col.getSQLType());
        if (want !== db.data_type) {
          problems.push(
            `${tableName}.${col.name}: type ${db.data_type} in database, ${want} in Drizzle`,
          );
        }
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
