import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, updatedAt, uuidPrimaryKey } from "./_shared.js";

export const SUBSCRIPTION_PLANS = ["trial", "standard", "professional", "enterprise"] as const;
export const ORGANIZATION_STATUSES = ["active", "suspended", "offboarding", "closed"] as const;

/** Migration 0003. One row per brokerage. */
export const organizations = pgTable(
  "organizations",
  {
    id: uuidPrimaryKey(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    /** ISO 3166-1 alpha-2 */
    country: text("country").notNull(),
    timezone: text("timezone").notNull().default("Africa/Nairobi"),
    /** ISO 4217 */
    currency: text("currency").notNull().default("KES"),
    settings: jsonb("settings")
      .notNull()
      .default(sql`'{}'::jsonb`),
    subscriptionPlan: text("subscription_plan").notNull().default("trial"),
    status: text("status").notNull().default("active"),
    /** users.id, set after the first user exists. No FK: users references organizations transitively. */
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    /**
     * Migration 0029. The caller's own key for one attempt at creating a brokerage.
     *
     * Nullable, because every brokerage created before 0029 has none and none was invented for
     * them. Where it is present it is unique per creator, so a retried or double-submitted
     * create request returns the brokerage it already made instead of a second one.
     */
    creationKey: uuid("creation_key"),
  },
  (t) => [
    check(
      "organizations_subscription_plan_check",
      sql`${t.subscriptionPlan} in ('trial','standard','professional','enterprise')`,
    ),
    check(
      "organizations_status_check",
      sql`${t.status} in ('active','suspended','offboarding','closed')`,
    ),
    index("organizations_status_idx")
      .on(t.status)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("organizations_created_by_creation_key")
      .on(t.createdBy, t.creationKey)
      .where(sql`${t.creationKey} is not null`),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
