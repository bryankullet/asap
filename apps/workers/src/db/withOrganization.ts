import { sql } from "drizzle-orm";
import type { WorkerDatabase } from "@asap/db";

/** The transaction handle passed to job code. */
export type OrganizationTransaction = Parameters<Parameters<WorkerDatabase["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every worker database call goes through this helper. A direct db.select() in a worker is a bug.
 *
 * Sets app.organization_id for the duration of one transaction. The `true` (is_local) argument
 * scopes the setting to the transaction, so it cannot leak into the next job on a pooled
 * connection: when the transaction ends, app.worker_org() returns null again and RLS returns
 * nothing. One organization per transaction — never batch across tenants.
 */
export async function withOrganization<T>(
  db: WorkerDatabase,
  organizationId: string,
  fn: (tx: OrganizationTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error("withOrganization: organizationId must be a UUID");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);
    return fn(tx);
  });
}
