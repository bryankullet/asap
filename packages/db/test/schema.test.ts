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

  it("lists exactly the eleven Phase 1 tables plus event_deliveries", () => {
    const names = Object.values(schema)
      .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v)
      .map((t) => getTableConfig(t as never).name)
      .sort();
    expect(names).toEqual([
      "audit_log",
      "event_deliveries",
      "events",
      "invitations",
      "organization_memberships",
      "organizations",
      "permissions",
      "role_permissions",
      "roles",
      "teams",
      "user_team_memberships",
      "users",
    ]);
  });
});
