import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients } from "./compliance.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const CONTACT_SOURCES = ["manual", "import", "email", "seed"] as const;

/**
 * Migration 0039. The people at a client (D-070).
 *
 * `source` is kept because where a contact came from decides how much it can be trusted: an
 * imported row is a claim the brokerage's old system made, a manual one is a person's own entry.
 *
 * Two partial unique indexes carry rules that matter more than they look: one primary contact per
 * client, and one row per email address per client — both over live rows only, so soft-deleting a
 * contact frees the address and the primary slot again.
 */
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    /** What they do for the client, in the client's own words. Not a role in ASAP. */
    roleLabel: text("role_label"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check("client_contacts_full_name_check", sql`length(btrim(${t.fullName})) > 0`),
    check("client_contacts_email_check", sql`${t.email} is null or position('@' in ${t.email}) > 1`),
    check("client_contacts_source_check", sql`${t.source} in ('manual','import','email','seed')`),
    uniqueIndex("client_contacts_one_primary")
      .on(t.clientId)
      .where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
    uniqueIndex("client_contacts_client_id_email_key")
      .on(t.clientId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    index("client_contacts_email_idx")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    index("client_contacts_client_id_idx")
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    index("client_contacts_organization_id_idx").on(t.organizationId),
    index("client_contacts_created_by_idx").on(t.createdBy),
  ],
);

export type ClientContact = typeof clientContacts.$inferSelect;
