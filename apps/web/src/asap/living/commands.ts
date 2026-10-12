import type { LivingAction, LivingCommand } from "@asap/schema";
import { api, describeApiError } from "../../lib/api.js";

/**
 * The browser half of the governed commands (D-157): a fixed table from command to the endpoint
 * that already owns it. The surface names a command and its target; it can never name a path.
 * Every endpoint checks the person's permission, the frozen payload and the record's state again,
 * and audits the outcome — this table only addresses it.
 */
const ROUTES: Record<LivingCommand, (target: string) => string> = {
  "workflow_approval.decide": (id) => `/workflow-approvals/${id}/decide`,
  "run.follow_up_now": (id) => `/workflows/runs/${id}/follow-up-now`,
  "run.move_follow_up": (id) => `/workflows/runs/${id}/follow-up`,
  "run.pause": (id) => `/workflows/runs/${id}/pause`,
  "run.resume": (id) => `/workflows/runs/${id}/resume`,
  "run.escalate": (id) => `/workflows/runs/${id}/escalate`,
  "quotation.record_delivery": (id) => `/opportunities/${id}/actions`,
  "quotation.record_response": (id) => `/opportunities/${id}/actions`,
  "placement.approve_request": (id) => `/placements/${id}/actions`,
  "placement.record_submission": (id) => `/placements/${id}/actions`,
  "issuance.approve_request": (id) => `/placements/${id}/issuance/actions`,
  "issuance.record_submission": (id) => `/placements/${id}/issuance/actions`,
  "claim.receive_document": (id) => `/claims/${id}/actions`,
  "endorsement.decide_item": (id) => `/endorsements/${id}/actions`,
  "quotation.confirm_reading": (id) => `/opportunities/${id}/actions`,
  "work.hand_over": (id) => `/work-items/${id}/hand-over`,
  "work.acknowledge_handover": (id) => `/work-handovers/${id}/acknowledge`,
};
/** Commands that record a fact once: a retried submit carries the same key and records one. */
const IDEMPOTENT = new Set<LivingCommand>(["placement.record_submission", "issuance.record_submission"]);

export type CommandAction = Extract<LivingAction, { kind: "command" }>;
export type CommandResult = { ok: boolean; message: string };

/** Builds the body: the server's fixed fields, then what the person filled in, typed. */
export function commandBody(a: CommandAction, values: Record<string, string>, idempotencyKey: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...a.payload };
  for (const i of a.inputs) {
    const v = (values[i.name] ?? "").trim();
    if (!v) continue;
    body[i.name] = i.kind === "datetime" ? new Date(v).toISOString() : v;
  }
  if (IDEMPOTENT.has(a.command)) body["idempotencyKey"] = idempotencyKey;
  return body;
}

export function missingInputs(a: CommandAction, values: Record<string, string>): string[] {
  return a.inputs.filter((i) => i.required && !(values[i.name] ?? "").trim()).map((i) => i.label);
}

export async function runCommand(a: CommandAction, values: Record<string, string>, idempotencyKey: string): Promise<CommandResult> {
  try {
    const r = await api.livingCommand(ROUTES[a.command](a.target), commandBody(a, values, idempotencyKey));
    if (r.outcome === "blocked") return { ok: false, message: r.reason ?? "The brokerage's rules did not allow it. Nothing was changed." };
    // Endpoints that answer with the updated record and no outcome succeeded: their errors are thrown.
    return { ok: true, message: r.outcome === "already" || r.outcome === "already_done" ? "That was already done — nothing changed." : "Done." };
  } catch (e) {
    return { ok: false, message: describeApiError(e) };
  }
}
