import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/**
 * A brokerage's own rules and market values (0052).
 *
 * Kenyan legal and market values are per-organization, never constants, and every rule carries
 * where it came from and when somebody last checked it. A rule whose provenance nobody remembers
 * is a hard-coded number hidden one layer down.
 */
export const companyRules = pgTable(
  "company_rules",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    verifiedAt: date("verified_at").notNull(),
    note: text("note"),
    setBy: uuid("set_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("company_rules_one_per_key").on(t.organizationId, t.key),
    check("company_rules_key_check", sql`${t.key} ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'`),
    check("company_rules_source_check", sql`length(btrim(${t.source})) > 0`),
    index("company_rules_organization_id_idx").on(t.organizationId),
    index("company_rules_set_by_idx").on(t.setBy),
  ],
);

/** Every value a rule has held. Changing a rule is a decision, so it is kept. */
export const companyRuleVersions = pgTable(
  "company_rule_versions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyRuleId: uuid("company_rule_id").references(() => companyRules.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    verifiedAt: date("verified_at").notNull(),
    note: text("note"),
    setBy: uuid("set_by")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("company_rule_versions_organization_id_idx").on(t.organizationId),
    index("company_rule_versions_company_rule_id_idx").on(t.companyRuleId),
    index("company_rule_versions_set_by_idx").on(t.setBy),
  ],
);

export type CompanyRule = typeof companyRules.$inferSelect;
export type CompanyRuleVersion = typeof companyRuleVersions.$inferSelect;
