import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";

/** Seeded for every new organization. Stable keys; names are what users see. */
export const DEFAULT_ROLE_KEYS = [
  "brokerage_admin",
  "account_executive",
  "placement_officer",
  "policy_administrator",
  "claims_officer",
  "renewals_officer",
  "finance_officer",
  "manager",
  "read_only",
] as const;
export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number];

export const PERMISSION_OBJECT_TYPES = [
  "client",
  "policy",
  "claim",
  "document",
  "email",
  "quote",
  "placement",
  "invoice",
  "payment",
  "commission",
  "space",
  "job",
  "automation",
  "report",
  "user",
  "role",
  "organization",
  "audit",
] as const;
export type PermissionObjectType = (typeof PERMISSION_OBJECT_TYPES)[number];

export const PERMISSION_VERBS = [
  "view",
  "create",
  "edit",
  "approve",
  "export",
  "delete",
  "send_external",
  "ai_execute",
] as const;
export type PermissionVerb = (typeof PERMISSION_VERBS)[number];

/** Migration 0005. Tenant-scoped: a brokerage may rename or add roles. */
export const roles = pgTable(
  "roles",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Seeded template, not user-created. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("roles_organization_id_key_key").on(t.organizationId, t.key)],
);

/** Migration 0005. Global reference data — the same verbs exist everywhere. */
export const permissions = pgTable(
  "permissions",
  {
    id: uuidPrimaryKey(),
    objectType: text("object_type").notNull(),
    verb: text("verb").notNull(),
    description: text("description"),
  },
  (t) => [
    check(
      "permissions_verb_check",
      sql`${t.verb} in ('view','create','edit','approve','export','delete','send_external','ai_execute')`,
    ),
    unique("permissions_object_type_verb_key").on(t.objectType, t.verb),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
