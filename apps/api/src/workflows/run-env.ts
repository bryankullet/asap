import type { Env } from "../placement/service.js";
import type { StepContext } from "./engine.js";
import { systemReadContext } from "./system-context.js";

/**
 * The placement and issuance services' environment, with a workflow run as the actor (D-142).
 *
 * The step calls the same service function a person's click calls, through the same guards. It is
 * given only the permissions that one automated action needs — never approve, send or record an
 * instruction — and every row it writes names the run, not a person (0068). Its audit rows are the
 * automation's.
 */
export function runEnv(ctx: StepContext, permissions: string[]): Env {
  const base = systemReadContext(ctx.run.organization_id);
  return {
    db: ctx.db,
    ctx: { ...base, permissions: new Set(permissions) } as Env["ctx"],
    organizationId: ctx.run.organization_id,
    // Never written as an actor: `runId` makes every actor column name the run.
    userId: "00000000-0000-4000-8000-000000000000",
    runId: ctx.run.id,
    audit: async (entry) => {
      await ctx.db.from("audit_log").insert({
        organization_id: ctx.run.organization_id,
        actor_type: "automation",
        action: entry.action,
        object_type: entry.objectType,
        object_id: entry.objectId ?? null,
        previous_state: entry.previousState ?? null,
        new_state: { ...(entry.newState ?? {}), byRun: ctx.run.id },
        result: entry.result,
        failure_reason: entry.failureReason ?? null,
      });
    },
  };
}
