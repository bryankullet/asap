import { sql } from "drizzle-orm";
import { bigint, check, index, inet, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const AUDIT_ACTOR_TYPES = ["user", "ai", "automation", "system"] as const;
export const AUDIT_RESULTS = ["success", "failure", "denied"] as const;

/**
 * Migration 0009. Insert-only: no application role has update or delete.
 * A denied action is still an audit row with result = 'denied'.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** 'membership.created', 'role.updated', ... */
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    previousState: jsonb("previous_state"),
    newState: jsonb("new_state"),
    /** Document/chunk refs, Phase 3 onward. */
    evidence: jsonb("evidence"),
    /** Phase 6 */
    approvalId: uuid("approval_id"),
    /** Phase 12 */
    automationRunId: uuid("automation_run_id"),
    result: text("result").notNull().default("success"),
    failureReason: text("failure_reason"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    check("audit_log_actor_type_check", sql`${t.actorType} in ('user','ai','automation','system')`),
    check("audit_log_result_check", sql`${t.result} in ('success','failure','denied')`),
    index("audit_log_organization_id_occurred_at_idx").on(t.organizationId, t.occurredAt.desc()),
    index("audit_log_organization_id_object_type_object_id_idx").on(
      t.organizationId,
      t.objectType,
      t.objectId,
    ),
    index("audit_log_organization_id_actor_user_id_occurred_at_idx").on(
      t.organizationId,
      t.actorUserId,
      t.occurredAt.desc(),
    ),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
