import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_shared.js";
import { conversations } from "./conversations.js";
import { organizations } from "./organizations.js";
import { opportunities } from "./quotations.js";
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

/** Migration 0078 (D-155). Personal, per brokerage; a convenience, never a record. */
export const recentItems = pgTable(
  "recent_items",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    refKey: text("ref_key").notNull(),
    kind: text("kind").notNull(),
    ref: jsonb("ref"),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    openedAt: timestamptz("opened_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.refKey] }),
    index("recent_items_person_idx").on(t.organizationId, t.userId, t.openedAt.desc()),
    index("recent_items_user_id_idx").on(t.userId),
    index("recent_items_conversation_id_idx").on(t.conversationId),
  ],
);

/** Migration 0078 (D-155). Personal, per brokerage; a convenience, never a record. */
export const spacePins = pgTable(
  "space_pins",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    refKey: text("ref_key").notNull(),
    kind: text("kind").notNull(),
    ref: jsonb("ref"),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.refKey] }),
    index("space_pins_person_idx").on(t.organizationId, t.userId, t.createdAt.desc()),
    index("space_pins_user_id_idx").on(t.userId),
    index("space_pins_conversation_id_idx").on(t.conversationId),
  ],
);

/** One person's arrangement of one composed surface in one brokerage (0080, D-157). Interface state only. */
export const surfacePreferences = pgTable(
  "surface_preferences",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    surfaceKey: text("surface_key").notNull(),
    prefs: jsonb("prefs").notNull().default(sql`'{}'::jsonb`),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.surfaceKey] }),
    index("surface_preferences_user_id_idx").on(t.userId),
  ],
);

/** Responsibility for a Work item moving between colleagues (0087, D-166). Written only by its functions. */
export const workHandovers = pgTable(
  "work_handovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id),
    fromUserId: uuid("from_user_id").notNull().references(() => users.id),
    toUserId: uuid("to_user_id").notNull().references(() => users.id),
    doneText: text("done_text").notNull(),
    openText: text("open_text").notNull(),
    watchText: text("watch_text"),
    createdAt: createdAt(),
    acknowledgedAt: timestamptz("acknowledged_at"),
  },
  (t) => [
    index("work_handovers_work_item_idx").on(t.workItemId, t.createdAt.desc()),
    index("work_handovers_organization_id_idx").on(t.organizationId),
    index("work_handovers_from_user_id_idx").on(t.fromUserId),
    index("work_handovers_to_user_id_idx").on(t.toUserId),
    check("work_handovers_check", sql`from_user_id <> to_user_id`),
  ],
);

/** A hypothetical saved from the exploration: insurers and answer revisions, never figures (0090, D-167). */
export const renewalProposals = pgTable(
  "renewal_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id),
    version: integer("version").notNull(),
    opportunityInsurerIds: uuid("opportunity_insurer_ids").array().notNull(),
    revisions: jsonb("revisions").notNull().default(sql`'{}'::jsonb`),
    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("renewal_proposals_work_item_id_version_key").on(t.workItemId, t.version),
    index("renewal_proposals_organization_id_idx").on(t.organizationId),
    index("renewal_proposals_opportunity_id_idx").on(t.opportunityId),
    index("renewal_proposals_created_by_idx").on(t.createdBy),
  ],
);
