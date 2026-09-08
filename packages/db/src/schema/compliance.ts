import { sql } from "drizzle-orm";
import { customType, date, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Migration 0026. */
export const insurers = pgTable(
  "insurers",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [unique("insurers_organization_id_name_key").on(t.organizationId, t.name)],
);

export const clients = pgTable(
  "clients",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    fileStatus: text("file_status").notNull().default("not_started"),
    fileOwnerId: uuid("file_owner_id").references(() => users.id),
    fileDecidedBy: uuid("file_decided_by").references(() => users.id),
    fileDecidedAt: timestamptz("file_decided_at"),
    fileDecisionReason: text("file_decision_reason"),
    refreshIntervalDays: integer("refresh_interval_days"),
    refreshDueAt: timestamptz("refresh_due_at"),
    search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(name, ''))`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("clients_organization_id_name_key").on(t.organizationId, t.name),
    index("clients_organization_id_file_status_idx").on(t.organizationId, t.fileStatus),
    index("clients_file_owner_id_idx").on(t.fileOwnerId),
    index("clients_file_decided_by_idx").on(t.fileDecidedBy),
    index("clients_created_by_idx").on(t.createdBy),
  ],
);

export const clientFileDocuments = pgTable(
  "client_file_documents",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    reference: text("reference"),
    requestedAt: timestamptz("requested_at"),
    receivedAt: timestamptz("received_at"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("client_file_documents_organization_id_idx").on(t.organizationId),
    index("client_file_documents_client_id_idx").on(t.clientId),
    index("client_file_documents_recorded_by_idx").on(t.recordedBy),
  ],
);

export const agreements = pgTable(
  "agreements",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    insurerId: uuid("insurer_id")
      .notNull()
      .references(() => insurers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    documentReference: text("document_reference"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("agreements_organization_id_insurer_id_key").on(t.organizationId, t.insurerId),
    index("agreements_insurer_id_idx").on(t.insurerId),
    index("agreements_created_by_idx").on(t.createdBy),
  ],
);

export const agreementVersions = pgTable(
  "agreement_versions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    paymentTermsDays: integer("payment_terms_days"),
    documentReference: text("document_reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("agreement_versions_agreement_id_version_key").on(t.agreementId, t.version),
    index("agreement_versions_organization_id_idx").on(t.organizationId),
    index("agreement_versions_created_by_idx").on(t.createdBy),
  ],
);

export const agreementRates = pgTable(
  "agreement_rates",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => agreementVersions.id, { onDelete: "cascade" }),
    classOfBusiness: text("class_of_business").notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull(),
    clauseReference: text("clause_reference"),
    proposedBy: text("proposed_by").notNull(),
    proposedByUser: uuid("proposed_by_user").references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamptz("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("agreement_rates_version_id_class_key").on(t.versionId, t.classOfBusiness),
    index("agreement_rates_organization_id_idx").on(t.organizationId),
    index("agreement_rates_proposed_by_user_idx").on(t.proposedByUser),
    index("agreement_rates_confirmed_by_idx").on(t.confirmedBy),
  ],
);
