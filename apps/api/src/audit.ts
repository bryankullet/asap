import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import type { Logger } from "pino";

export type AuditEntry = {
  organizationId: string;
  actorUserId: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  result: "success" | "failure" | "denied";
  failureReason?: string | null;
};

/** Never audit these: they are credentials or document contents (docs/SECRETS.md). */
const REDACT_KEYS = /token|secret|password|authorization|body_text|body_html|content/i;

export function redactForAudit(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT_KEYS.test(k) ? "[redacted]" : v;
  return out;
}

/**
 * Application-level audit for anything a database function cannot see — in Phase 1 chiefly
 * denied attempts, which a function cannot persist because its own exception rolls them back.
 * Inserted under the caller's session: the 0011 audit_insert policy requires membership of the
 * organization, which every caller reaching this code has.
 */
export async function recordAudit(
  db: SupabaseClient,
  logger: Logger,
  c: Context,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    organization_id: entry.organizationId,
    actor_type: "user",
    actor_user_id: entry.actorUserId,
    action: entry.action,
    object_type: entry.objectType,
    object_id: entry.objectId ?? null,
    previous_state: redactForAudit(entry.previousState),
    new_state: redactForAudit(entry.newState),
    result: entry.result,
    failure_reason: entry.failureReason ?? null,
    ip_address:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null,
    user_agent: c.req.header("user-agent") ?? null,
  });
  if (error) {
    // An audit failure must be loud in logs; it must not turn a denied request into a 500.
    logger.error({ err: error, action: entry.action }, "audit write failed");
  }
}
