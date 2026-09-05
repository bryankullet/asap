import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type WorkerDatabase = ReturnType<typeof createWorkerDb>;

/**
 * Connection for background workers. The URL must authenticate as `asap_worker`, a role
 * that does not bypass RLS; app.worker_org() decides what each transaction may see.
 * Callers set that context through apps/workers' withOrganization helper — never here,
 * because a connection-level setting would leak between pooled jobs.
 */
export function createWorkerDb(connectionUrl: string, options: { max?: number } = {}) {
  const sql = postgres(connectionUrl, {
    max: options.max ?? 10,
    // Workers should fail loudly on a dead connection rather than hang a job.
    connect_timeout: 10,
    prepare: false,
  });
  return drizzle(sql, { schema, casing: "snake_case" });
}
