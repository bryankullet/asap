import { sql } from "drizzle-orm";
import { createWorkerDb } from "@asap/db";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchPending } from "../src/events/dispatcher.js";

/**
 * The event dispatcher, against a real database.
 *
 * It has to be a real one. What makes this loop safe to crash and restart is a database
 * constraint — `event_deliveries` has `(event_id, consumer)` as its primary key — and a stand-in
 * that accepted every insert would pass these tests while the real thing let a consumer run twice.
 *
 * Needs a migrated database reachable as asap_worker. Set WORKER_DATABASE_URL; skipped otherwise
 * so `pnpm test` stays runnable without Postgres.
 */
const url = process.env["WORKER_DATABASE_URL"];
const describeDb = url ? describe : describe.skip;

const logger = pino({ level: "silent" });

describeDb("the event dispatcher", () => {
  const db = createWorkerDb(url ?? "postgresql://unused:unused@127.0.0.1/unused", { max: 2 });
  /*
   * Events are written by the API, which holds a service key; the worker only ever reads that one
   * exists. So the fixtures are written on an owner connection — writing them as the worker would
   * be testing a path the product does not have.
   */
  const owner = createWorkerDb(
    process.env["OWNER_DATABASE_URL"] ?? "postgresql://unused:unused@127.0.0.1/unused",
    { max: 1 },
  );
  const ORG = "10000000-0000-4000-8000-00000000000a";

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
    await owner.$client.end({ timeout: 1 });
  });

  /** An event of this brokerage's, unhandled. Returns its id. */
  async function givenEvent(type = "document.received", payload = "{}"): Promise<string> {
    const rows = await owner.execute<{ id: string }>(sql`
      insert into events (organization_id, event_type, entity_type, entity_id, actor, payload)
      values (${ORG}, ${type}, 'document', gen_random_uuid(), 'user', ${payload}::jsonb)
      returning id
    `);
    return rows[0]!.id;
  }

  async function eventRow(id: string) {
    const rows = await owner.execute<{
      processed_at: string | null;
      processing_attempts: number;
      last_error: string | null;
    }>(sql`select processed_at, processing_attempts, last_error from events where id = ${id}`);
    return rows[0]!;
  }

  async function deliveries(id: string) {
    return owner.execute<{ consumer: string; result: string; error: string | null }>(
      sql`select consumer, result, error from event_deliveries where event_id = ${id}`,
    );
  }

  beforeEach(async () => {
    // Each case owns its own events; the seed's are left alone by marking them handled.
    await owner.execute(sql`update events set processed_at = now() where processed_at is null`);
  });

  it("records what each consumer did and marks the event handled", async () => {
    const id = await givenEvent();
    const handled = await dispatchPending({
      db,
      logger,
      dispatch: async () => [
        { consumer: "automations", result: "success", detail: "No automation is watching for this." },
      ],
    });
    expect(handled).toBe(1);
    expect((await eventRow(id)).processed_at).not.toBeNull();
    expect(await deliveries(id)).toEqual([
      { consumer: "automations", result: "success", error: null },
    ]);
  });

  it("never runs a consumer twice for the same event", async () => {
    const id = await givenEvent();
    let calls = 0;
    const dispatch = async () => {
      calls++;
      return [{ consumer: "automations", result: "success" as const, detail: "ran" }];
    };
    await dispatchPending({ db, logger, dispatch });
    // The event is handled now, so a second sweep does not pick it up at all.
    await dispatchPending({ db, logger, dispatch });
    expect(calls).toBe(1);
    expect(await deliveries(id)).toHaveLength(1);
  });

  it("keeps the first answer when a delivery is recorded twice", async () => {
    // What a crash between dispatching and marking the event handled looks like: the loop starts
    // again and dispatches the same event. The primary key is what stops the second answer
    // overwriting the first, so history cannot be rewritten by a retry.
    const id = await givenEvent();
    await dispatchPending({
      db,
      logger,
      dispatch: async () => [{ consumer: "automations", result: "success", detail: "first" }],
    });
    await owner.execute(sql`update events set processed_at = null where id = ${id}`);
    await dispatchPending({
      db,
      logger,
      dispatch: async () => [{ consumer: "automations", result: "failure", detail: "second" }],
    });
    const rows = await deliveries(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toBe("success");
  });

  it("leaves an event unprocessed when a consumer fails, and says why", async () => {
    const id = await givenEvent();
    const handled = await dispatchPending({
      db,
      logger,
      dispatch: async () => [
        { consumer: "automations", result: "failure", detail: "the engine refused" },
      ],
    });
    expect(handled).toBe(0);
    const row = await eventRow(id);
    // Not marked done: a failure that stopped being retried must stay visible as a failure.
    expect(row.processed_at).toBeNull();
    expect(row.processing_attempts).toBe(1);
    expect(row.last_error).toMatch(/the engine refused/);
    expect((await deliveries(id))[0]!.result).toBe("failure");
  });

  it("counts an attempt when the API cannot be reached at all", async () => {
    const id = await givenEvent();
    await dispatchPending({
      db,
      logger,
      dispatch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const row = await eventRow(id);
    expect(row.processing_attempts).toBe(1);
    expect(row.last_error).toMatch(/ECONNREFUSED/);
    // Nothing was recorded as delivered: the consumers never ran.
    expect(await deliveries(id)).toHaveLength(0);
  });

  it("stops picking up an event that has failed too many times", async () => {
    const id = await givenEvent();
    await owner.execute(sql`update events set processing_attempts = 5 where id = ${id}`);
    let calls = 0;
    await dispatchPending({
      db,
      logger,
      dispatch: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
    // Still unprocessed, still carrying its error: given up on, not quietly completed.
    expect((await eventRow(id)).processed_at).toBeNull();
  });

  it("records a skip as a skip, which is not a failure", async () => {
    const id = await givenEvent();
    const handled = await dispatchPending({
      db,
      logger,
      dispatch: async () => [
        {
          consumer: "automations",
          result: "skipped",
          detail: "The event does not belong to a piece of work.",
        },
      ],
    });
    // Nothing was waiting for it, which is a complete answer: the event is handled.
    expect(handled).toBe(1);
    expect((await eventRow(id)).processed_at).not.toBeNull();
    expect((await deliveries(id))[0]!.result).toBe("skipped");
  });

  it("handles the oldest events first", async () => {
    const first = await givenEvent("document.received");
    const second = await givenEvent("run.could_not_finish");
    await owner.execute(sql`update events set occurred_at = now() - interval '1 hour' where id = ${first}`);
    const order: string[] = [];
    await dispatchPending({
      db,
      logger,
      dispatch: async (eventId) => {
        order.push(eventId);
        return [{ consumer: "automations", result: "success", detail: "ok" }];
      },
    });
    expect(order).toEqual([first, second]);
  });
});
