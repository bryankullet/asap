import { createHash } from "node:crypto";
import { deriveTask, renewalSteps, type PrepareActionResponse, type PreparedActionView } from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError } from "../errors.js";
import { names, toPreparedView, type Env } from "../placement/service.js";
import { loadPolicySpace, policyFingerprint, renewalTitle } from "./space.js";

/**
 * Policy workflow actions (4C-1). One is backed: starting a renewal. It runs the same engine
 * function the creation form uses (`work_item_create`), titled by the policy so a second start
 * reopens the first — never a duplicate. Ask may only prepare it; a person confirms it.
 *
 * A claim or an endorsement is never prepared from here: each needs facts only a person can give
 * (the incident, the change asked for), so both open their forms with the client and policy
 * preselected and write nothing until the person submits.
 */

const VALID_FOR_MS = 24 * 60 * 60 * 1000;

export async function startRenewal(env: Env, policyId: string): Promise<{ outcome: "done" | "already" | "blocked"; reason: string | null; workItemId: string | null; receipt: string | null }> {
  if (!hasPermission(env.ctx, "policy", "edit")) return { outcome: "blocked", reason: "You may not start work on a policy.", workItemId: null, receipt: null };
  const v = await loadPolicySpace(env, policyId, { readOnly: true });
  const pol = (await env.db.from("policies").select("policy_number, class_of_business, insurer_id").eq("organization_id", env.organizationId).eq("id", policyId).maybeSingle()).data as { policy_number: string | null; class_of_business: string; insurer_id: string } | null;
  if (!pol) throw new HttpError(404, "not_found");
  const title = renewalTitle(v.client.name, pol.class_of_business, pol.policy_number);
  const steps = renewalSteps({ clientName: v.client.name, insurers: [] });
  const task = deriveTask(steps);
  const { data, error } = await env.db.rpc("work_item_create", {
    p_organization_id: env.organizationId, p_kind: "renewal", p_title: title, p_client_name: v.client.name, p_steps: steps,
    p_task_status: task.status, p_task_party: task.party, p_client_id: v.client.id, p_insurer_id: pol.insurer_id, p_class_of_business: pol.class_of_business,
  });
  if (error) return { outcome: "blocked", reason: "The renewal could not be started. Try again.", workItemId: null, receipt: null };
  const r = data as { id: string; reopened: boolean };
  await env.audit({ action: r.reopened ? "policy.renewal_reopened" : "policy.renewal_started", objectType: "policy", objectId: policyId, result: "success", newState: { workItemId: r.id } });
  return {
    outcome: r.reopened ? "already" : "done", reason: null, workItemId: r.id,
    receipt: r.reopened ? `The renewal for ${title.replace(/^.* — renewal, /, "")} was already open; nothing was duplicated.` : `Renewal started for ${v.client.name}, ${pol.class_of_business}${pol.policy_number ? ` ${pol.policy_number}` : ""}.`,
  };
}

/** Prepare — never perform — a renewal start, for the person to confirm. */
export async function preparePolicyAction(env: Env, policyId: string, actionType: string): Promise<PrepareActionResponse> {
  const refused = (reason: string): PrepareActionResponse => ({ state: "refused", reason });
  if (actionType !== "start_renewal") return refused("Only starting a renewal can be prepared from a policy. A claim or a change opens its form, which needs facts only you can give.");
  const v = await loadPolicySpace(env, policyId, { readOnly: true });
  const open = v.work.find((w) => w.kind === "renewal");
  const permitted = hasPermission(env.ctx, "policy", "edit");
  const fp = policyFingerprint(v);
  const payload = { action: "start_renewal", policyId };
  const changes = [
    `Start the renewal of ${v.title}`,
    open ? "A renewal is already open for this policy; confirming opens it and creates nothing new." : "A renewal work item, titled by this policy. Nothing is sent to any insurer.",
  ];
  const blockers = [...(permitted ? [] : ["You may not do this. Someone with the permission must confirm it."]), ...(v.conflicts.length > 0 ? ["The policy's periods overlap; the renewal can start, but settle the periods first."] : [])];
  const key = createHash("sha256").update([env.userId, "start_renewal", policyId, fp.fingerprint].join("|")).digest("hex");
  const existing = await env.db.from("prepared_actions").select("*").eq("organization_id", env.organizationId).eq("idempotency_key", key).maybeSingle();
  if (existing.data) return { state: "prepared", action: await viewOf(env, existing.data as Record<string, unknown>) };
  const ins = await env.db.from("prepared_actions").insert({
    organization_id: env.organizationId, policy_id: policyId, placement_id: null, opportunity_id: null, action_type: "start_renewal",
    payload, source_versions: fp.versions, fingerprint: fp.fingerprint, changes, blockers, permitted, requires_confirmation: true,
    idempotency_key: key, prepared_by: env.userId, expires_at: new Date(Date.now() + VALID_FOR_MS).toISOString(),
  }).select("*").maybeSingle();
  if (ins.error || !ins.data) return refused("The action could not be prepared. Try again.");
  const row = ins.data as Record<string, unknown>;
  await env.audit({ action: "prepared_action.prepared", objectType: "prepared_action", objectId: row["id"] as string, result: "success", newState: { actionType: "start_renewal", policyId } });
  return { state: "prepared", action: await viewOf(env, row) };
}

async function viewOf(env: Env, row: Record<string, unknown>): Promise<PreparedActionView> {
  return toPreparedView(row, await names(env.db, [row["prepared_by"] as string, row["decided_by"] as string]));
}

/** Is a prepared policy action still about the facts as they stand? */
export async function currentPolicyFingerprint(env: Env, policyId: string): Promise<string> {
  return policyFingerprint(await loadPolicySpace(env, policyId, { readOnly: true })).fingerprint;
}
