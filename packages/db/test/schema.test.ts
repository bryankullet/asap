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
];

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

  it("lists exactly the eleven Phase 1 tables, event_deliveries, and the 0022/0023 engine tables and the 0026/0028 servicing tables", () => {
    const names = Object.values(schema)
      .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v)
      .map((t) => getTableConfig(t as never).name)
      .sort();
    expect(names).toEqual([
      "agreement_rates",
      "agreement_versions",
      "agreements",
      "audit_log",
      "claim_documents",
      "claim_notes",
      "claims",
      "client_file_documents",
      "clients",
      "drafts",
      "endorsements",
      "event_deliveries",
      "events",
      "insurers",
      "invitations",
      "organization_memberships",
      "organizations",
      "permissions",
      "policies",
      "policy_periods",
      "policy_versions",
      "role_permissions",
      "roles",
      "run_events",
      "runs",
      "teams",
      "user_team_memberships",
      "users",
      "work_items",
    ]);
  });
});
