import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { roles } from "./roles.js";
import { users } from "./users.js";

export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;

/** Migration 0008. Stores the token hash, never the token. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "invitations_status_check",
      sql`${t.status} in ('pending','accepted','revoked','expired')`,
    ),
    index("invitations_accepted_by_idx").on(t.acceptedBy),
    index("invitations_invited_by_idx").on(t.invitedBy),
    index("invitations_role_id_idx").on(t.roleId),
    index("invitations_organization_id_status_idx").on(t.organizationId, t.status),
    // One live invitation per email per organization.
    uniqueIndex("invitations_one_pending_per_email_idx")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
