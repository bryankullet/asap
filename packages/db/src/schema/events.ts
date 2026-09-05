import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const EVENT_ACTORS = ["user", "ai", "automation", "system"] as const;
/** Phase 1 event types. The full catalogue (§29) arrives with its phase. */
export const PHASE_1_EVENT_TYPES = ["record.changed", "schedule.fired", "user.action"] as const;
export const EVENT_DELIVERY_RESULTS = ["success", "failure", "skipped"] as const;

/** Migration 0010. A dispatch log with a retention policy, not the system of record. */
export const events = pgTable(
  "events",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    actor: text("actor").notNull().default("system"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** before/after for changes */
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    check("events_actor_check", sql`${t.actor} in ('user','ai','automation','system')`),
    index("events_organization_id_occurred_at_idx").on(t.organizationId, t.occurredAt.desc()),
    index("events_organization_id_event_type_occurred_at_idx").on(
      t.organizationId,
      t.eventType,
      t.occurredAt.desc(),
    ),
    index("events_unprocessed_idx")
      .on(t.occurredAt)
      .where(sql`${t.processedAt} is null`),
    index("events_entity_type_entity_id_idx").on(t.entityType, t.entityId),
  ],
);

/** Per-consumer idempotency. One event, many consumers, each recording its own outcome. */
export const eventDeliveries = pgTable(
  "event_deliveries",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    consumer: text("consumer").notNull(),
    processedAt: timestamptz("processed_at").notNull().defaultNow(),
    result: text("result").notNull().default("success"),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.consumer] }),
    check("event_deliveries_result_check", sql`${t.result} in ('success','failure','skipped')`),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventDelivery = typeof eventDeliveries.$inferSelect;
