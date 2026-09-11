import { sql } from "drizzle-orm";
import { eventDeliveries, type WorkerDatabase } from "@asap/db";
import type { Logger } from "pino";
import { withOrganization } from "../db/withOrganization.js";

/**
 * The event dispatcher: the worker tier's first real job.
 *
 * It claims events nobody has handled, asks the API to run the consumers, and records what each
 * one did. The split matters. **The worker schedules; the API is the engine.** Workers read tenant
 * data as `asap_worker` under RLS and hold no service key — that is their environment's own
 * constraint — while what must happen when an event lands is engine work that already exists,
 * tested, in the API. Running it in both places would be two implementations of the same rules
 * behind two different roles, which is how they drift.
 *
 * **Every consumer is idempotent by construction** (§29). `event_deliveries` has `(event_id,
 * consumer)` as its primary key, so a consumer that already ran for an event cannot run again — a
 * duplicated delivery is refused by the database rather than remembered in code. That is what
 * makes it safe for this loop to crash halfway and start again.
 */

/** What the API says one consumer did with one event. */
type ConsumerResult = { consumer: string; result: "success" | "failure" | "skipped"; detail: string };

export type DispatchDeps = {
  db: WorkerDatabase;
  logger: Logger;
  /** Calls the API's internal surface. Injected so the loop is testable without a server. */
  dispatch: (eventId: string) => Promise<ConsumerResult[]>;
  /** How many attempts an event gets before it is left alone. */
  maxAttempts?: number;
};

/**
 * The most times an event is retried before the loop stops picking it up.
 *
 * It is left unprocessed rather than marked done: a failure that stops being retried must still be
 * visible as a failure, and `last_error` says what happened. An event that quietly became
 * "processed" after failing would be the exact thing §45 rule 15 forbids.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

export async function dispatchPending(deps: DispatchDeps, limit = 20): Promise<number> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  /*
   * Claiming spans tenants, and `events` does not: it is a tenant table whose policy scopes every
   * read to one organization. A plain select here returns nothing at all — silently, which is how
   * a dispatcher ends up looking busy and doing nothing.
   *
   * `app.claim_pending_events` (0042) is the narrow way through: granted to this role alone, it
   * returns that an event exists, whose it is, and how often it has been tried. **Not its
   * payload** — that is the brokerage's own data, and the worker never needs it, because the work
   * itself happens in the API against the event's own organization.
   */
  const pending = await deps.db.execute<{
    id: string;
    organization_id: string;
    event_type: string;
    processing_attempts: number;
  }>(sql`select * from app.claim_pending_events(${limit}, ${maxAttempts})`);

  let handled = 0;
  for (const row of pending) {
    const event = {
      id: row.id,
      organizationId: row.organization_id,
      eventType: row.event_type,
      attempts: row.processing_attempts,
    };
    let results: ConsumerResult[];
    try {
      results = await deps.dispatch(event.id);
    } catch (e) {
      const message = (e as { message?: string } | null)?.message ?? "the consumers could not run";
      await deps.db.execute(
        sql`select app.mark_event_attempted(${event.id}, ${message})`,
      );
      deps.logger.error(
        { eventId: event.id, eventType: event.eventType, attempt: event.attempts + 1 },
        "event dispatch failed; it will be tried again",
      );
      continue;
    }

    await withOrganization(deps.db, event.organizationId, async (tx) => {
      for (const r of results) {
        /*
         * The primary key is the idempotency. A consumer that already has a delivery for this
         * event keeps the one it has: the first answer is the true one, and overwriting it would
         * let a retry rewrite history.
         */
        await tx
          .insert(eventDeliveries)
          .values({
            eventId: event.id,
            consumer: r.consumer,
            result: r.result,
            error: r.result === "failure" ? r.detail.slice(0, 500) : null,
          })
          .onConflictDoNothing();
      }
    });

    const failed = results.filter((r) => r.result === "failure");
    if (failed.length > 0) {
      // Not processed: a failure that is left alone must stay visible as one.
      await deps.db.execute(
        sql`select app.mark_event_attempted(${event.id}, ${failed.map((f) => `${f.consumer}: ${f.detail}`).join("; ")})`,
      );
      deps.logger.warn(
        { eventId: event.id, eventType: event.eventType, consumers: failed.map((f) => f.consumer) },
        "a consumer failed on this event",
      );
      continue;
    }

    await deps.db.execute(sql`select app.mark_event_processed(${event.id})`);
    handled++;
  }

  return handled;
}

/** Calls the API's internal surface for one event. */
export function httpDispatcher(config: {
  apiBaseUrl: string;
  internalKey: string;
  timeoutMs: number;
}): (eventId: string) => Promise<ConsumerResult[]> {
  return async (eventId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(
        new URL(`/internal/events/${eventId}/dispatch`, config.apiBaseUrl),
        {
          method: "POST",
          headers: { "x-asap-internal-key": config.internalKey },
          signal: controller.signal,
        },
      );
      if (!res.ok) throw new Error(`the API answered ${res.status}`);
      const body = (await res.json()) as { results?: ConsumerResult[] };
      return body.results ?? [];
    } finally {
      clearTimeout(timer);
    }
  };
}
