import { sql } from "drizzle-orm";
import { createWorkerDb } from "@asap/db";
import { afterAll, describe, expect, it } from "vitest";
import { withOrganization } from "../src/db/withOrganization.js";

/**
 * Integration test: needs a migrated database reachable as asap_worker.
 * Set WORKER_DATABASE_URL (CI after `supabase db reset`, or scripts/db-verify-local.sh).
 * Skipped otherwise so `pnpm test` stays runnable on a laptop without Postgres.
 */
const url = process.env["WORKER_DATABASE_URL"];
const describeDb = url ? describe : describe.skip;

describeDb("withOrganization", () => {
  const db = createWorkerDb(url ?? "postgresql://unused:unused@127.0.0.1/unused", { max: 1 });
  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("rejects a non-UUID organization id before touching the database", async () => {
    await expect(withOrganization(db, "not-a-uuid", async () => 1)).rejects.toThrow(/UUID/);
  });

  it("sets app.organization_id inside the transaction and clears it afterwards", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const inside = await withOrganization(db, orgId, async (tx) => {
      const rows = await tx.execute<{ org: string | null }>(
        sql`select app.worker_org()::text as org`,
      );
      return rows[0]?.org ?? null;
    });
    expect(inside).toBe(orgId);

    const after = await db.execute<{ org: string | null }>(
      sql`select app.worker_org()::text as org`,
    );
    expect(after[0]?.org ?? null).toBeNull();
  });
});
