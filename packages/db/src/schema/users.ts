import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_shared.js";

export const USER_STATUSES = ["active", "disabled"] as const;

/**
 * Migration 0004. Profile table mirroring auth.users; the id is the auth user id.
 * Not tenant-scoped — a person can work at two brokerages. Tenancy lives in
 * organization_memberships.
 */
export const users = pgTable(
  "users",
  {
    /** references auth.users(id) on delete cascade — the auth schema is outside Drizzle's view. */
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    fullName: text("full_name"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone"),
    lastSeenAt: timestamptz("last_seen_at"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_status_check", sql`${t.status} in ('active','disabled')`)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
