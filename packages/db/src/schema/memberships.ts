import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { roles } from "./roles.js";
import { users } from "./users.js";

export const MEMBERSHIP_STATUSES = ["active", "suspended", "removed"] as const;

/** Migration 0006. Where tenancy lives. */
export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** on delete restrict: deleting a role people hold must fail loudly. */
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    isOwner: boolean("is_owner").notNull().default(false),
    invitedBy: uuid("invited_by").references(() => users.id),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "organization_memberships_status_check",
      sql`${t.status} in ('active','suspended','removed')`,
    ),
    unique("organization_memberships_organization_id_user_id_key").on(t.organizationId, t.userId),
    index("organization_memberships_user_id_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
    index("organization_memberships_organization_id_idx")
      .on(t.organizationId)
      .where(sql`${t.status} = 'active'`),
    // Exactly one owner per organization.
    uniqueIndex("organization_memberships_one_owner_idx")
      .on(t.organizationId)
      .where(sql`${t.isOwner} and ${t.status} = 'active'`),
  ],
);

export type OrganizationMembership = typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembership = typeof organizationMemberships.$inferInsert;
