import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_shared.js";

/**
 * Migration 0031. The registry of renderable components (D-059, architecture §18).
 *
 * Platform configuration, not tenant data: every brokerage renders from the same registry, so
 * there is no `organization_id` here and no per-brokerage row. A component arrives by migration
 * and is readable by the worker; nothing in the database gives any role a write path to it.
 *
 * Versioned, because a stored block keeps the version it was rendered with: a Space rendered in
 * 2026 must still render in 2028. Deprecating means migrating stored blocks, never deleting a row.
 */
export const componentDefinitions = pgTable(
  "component_definitions",
  {
    componentId: text("component_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    /** Which Space types may carry this block. A plan naming any other is rejected. */
    allowedSpaces: text("allowed_spaces").array().notNull(),
    /** Permissions the caller must hold. Filtering is server-side (§34): never render-then-hide. */
    requiredPermissions: text("required_permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    canContainAction: boolean("can_contain_action").notNull(),
    requiresEvidence: boolean("requires_evidence").notNull(),
    /** JSON Schema of the matching Zod shape in packages/schema/src/spaces/blocks.ts. */
    propsSchema: jsonb("props_schema").notNull(),
    deprecatedAt: timestamptz("deprecated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.componentId, t.version] }),
    check("component_definitions_version_check", sql`${t.version} >= 1`),
    check("component_definitions_name_check", sql`length(btrim(${t.name})) > 0`),
    check("component_definitions_purpose_check", sql`length(btrim(${t.purpose})) > 0`),
    check(
      "component_definitions_allowed_spaces_check",
      sql`cardinality(${t.allowedSpaces}) > 0`,
    ),
  ],
);

export type ComponentDefinition = typeof componentDefinitions.$inferSelect;
