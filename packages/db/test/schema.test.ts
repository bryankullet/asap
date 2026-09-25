import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema/index.js";

const TENANT_TABLES = [
  schema.roles,
  schema.organizationMemberships,
  schema.teams,
  schema.invitations,
  schema.auditLog,
  schema.events,
  schema.workItems,
  schema.runs,
  schema.runEvents,
  schema.drafts,
  schema.insurers,
  schema.clients,
  schema.clientFileDocuments,
  schema.agreements,
  schema.agreementVersions,
  schema.agreementRates,
  schema.policies,
  schema.policyPeriods,
  schema.policyVersions,
  schema.claims,
  schema.claimDocuments,
  schema.claimNotes,
  schema.endorsements,
  schema.conversations,
  schema.conversationMessages,
  schema.workItemPins,
  schema.documents,
  schema.documentPages,
  schema.documentFields,
  schema.documentApplications,
  schema.mailboxes,
  schema.emailThreads,
  schema.emailMessages,
  schema.emailAttachments,
  schema.emailSendAttempts,
  schema.automations,
  schema.automationRuns,
  schema.clientContacts,
  schema.importBatches,
  schema.importRows,
];

/**
 * The one public table with no `organization_id`, and it is deliberate: the component registry is
 * platform configuration like `roles` and `permissions`. Every brokerage renders from the same
 * registry, so a per-brokerage row would be wrong rather than missing.
 */
const PLATFORM_TABLES = [schema.componentDefinitions];

describe("Drizzle schema conventions", () => {
  it("every tenant table carries a not-null organization_id referencing organizations", () => {
    for (const table of TENANT_TABLES) {
      const cfg = getTableConfig(table);
      const col = cfg.columns.find((c) => c.name === "organization_id");
      expect(col, `${cfg.name} has organization_id`).toBeDefined();
      expect(col?.notNull, `${cfg.name}.organization_id not null`).toBe(true);
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "organization_id"),
      );
      expect(fk, `${cfg.name}.organization_id has a foreign key`).toBeDefined();
      expect(getTableConfig(fk!.reference().foreignTable).name).toBe("organizations");
    }
  });

  it("no platform table carries an organization_id, which is what makes it platform configuration", () => {
    for (const table of PLATFORM_TABLES) {
      const cfg = getTableConfig(table);
      expect(cfg.columns.find((c) => c.name === "organization_id")).toBeUndefined();
    }
  });

  /*
   * Every public table through migration 0047. The list is written out rather than counted so
   * that adding a table to the database without representing it here — or representing one that
   * no migration creates — fails this test rather than the drift check against a live database,
   * which not every contributor can run.
   */
  it("lists exactly the tables the migrations create, through 0048", () => {
    const names = Object.values(schema)
      .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v)
      .map((t) => getTableConfig(t as never).name)
      .sort();
    expect(names).toEqual([
      "agreement_rates",
      "agreement_versions",
      "agreements",
      "audit_log",
      "automation_runs",
      "automations",
      "claim_documents",
      "claim_notes",
      "claims",
      "client_contacts",
      "client_file_documents",
      "clients",
      "component_definitions",
      "conversation_messages",
      "conversations",
      "document_applications",
      "document_fields",
      "document_pages",
      "documents",
      "drafts",
      "email_attachments",
      "email_drafts",
      "email_messages",
      "email_send_attempts",
      "email_threads",
      "endorsements",
      "event_deliveries",
      "events",
      "import_batches",
      "import_rows",
      "insurer_responses",
      "insurers",
      "invitations",
      "mailbox_oauth_states",
      "mailbox_sync_runs",
      "mailboxes",
      "opportunities",
      "opportunity_insurers",
      "opportunity_requirements",
      "organization_memberships",
      "organizations",
      "permissions",
      "policies",
      "policy_periods",
      "policy_versions",
      "quote_requests",
      "quote_terms",
      "requirement_templates",
      "role_permissions",
      "roles",
      "run_events",
      "runs",
      "teams",
      "user_onboarding",
      "user_team_memberships",
      "users",
      "work_item_pins",
      "work_items",
    ]);
  });
});
