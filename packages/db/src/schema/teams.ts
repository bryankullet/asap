import { pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/** Migration 0007. Teams do not grant permissions in Phase 1. */
export const teams = pgTable(
  "teams",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    leadUserId: uuid("lead_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [unique("teams_organization_id_name_key").on(t.organizationId, t.name)],
);

export const userTeamMemberships = pgTable(
  "user_team_memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export type Team = typeof teams.$inferSelect;
export type UserTeamMembership = typeof userTeamMemberships.$inferSelect;
