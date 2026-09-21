import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

/**
 * Migration 0033. Pinned is a personal marker, not a state work is in (D-075).
 *
 * One row per person per work item, which is why the primary key is the pair: pinning is a way of
 * finding work again, and one person's marker says nothing about anyone else's queue.
 */
export const workItemPins = pgTable(
  "work_item_pins",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemId, t.userId] }),
    check("work_item_pins_note_check", sql`${t.note} is null or length(btrim(${t.note})) > 0`),
    index("work_item_pins_user_idx").on(t.userId, t.organizationId, t.createdAt.desc()),
    index("work_item_pins_organization_id_idx").on(t.organizationId),
  ],
);

export type WorkItemPin = typeof workItemPins.$inferSelect;
