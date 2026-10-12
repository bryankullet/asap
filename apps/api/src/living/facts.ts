import { WORK_ITEM_COLUMNS, WorkItemRow, type IssuanceResponse, type OpportunityResponse, type PlacementResponse, type WorkflowDetail } from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import { loadIssuance } from "../placement/issuance.js";
import { load as loadPlacement, type Env } from "../placement/service.js";
import { loadOpportunity } from "../routes/opportunities.js";
import { loadWorkflowDetail } from "../routes/workflows.js";

/**
 * Everything a Living renewal surface is composed from (D-156), read under the viewer's own session
 * so RLS decides what exists for them. Each part is loaded by the module that already owns it —
 * the renewal run, the quotation, the placement, the issuance — so no business rule is re-derived
 * here: this file joins, it does not decide.
 */
export type Revision = { insurerName: string; revision: number; premiumAmount: string | null; premiumCurrency: string | null; validUntil: string | null; outcome: string; receivedAt: string | null; documentId: string | null };
export type AuditEvent = { at: string; action: string; actor: string | null };

export type RenewalLivingFacts = {
  item: WorkItemRow;
  client: { id: string; name: string } | null;
  period: { periodStart: string; periodEnd: string; insurerName: string; policyNumber: string | null; classOfBusiness: string } | null;
  ownerName: string | null;
  run: WorkflowDetail | null;
  opportunity: OpportunityResponse | null;
  revisions: Revision[];
  placement: PlacementResponse | null;
  issuance: IssuanceResponse | null;
  recent: AuditEvent[];
};

const quiet = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
};

export async function loadRenewalLivingFacts(env: Env, workItemId: string): Promise<RenewalLivingFacts> {
  const { db, organizationId: org } = env;
  const w = await db.from("work_items").select(WORK_ITEM_COLUMNS).eq("organization_id", org).eq("id", workItemId).is("deleted_at", null).maybeSingle();
  if (w.error) throw mapDatabaseError(w.error);
  if (!w.data) throw new HttpError(404, "not_found", "That work is not available.");
  const item = WorkItemRow.parse(w.data);
  if (item.kind !== "renewal") throw new HttpError(404, "not_found", "A living workspace is composed for renewals so far.");

  const [clientR, ownerR, runR, oppR] = await Promise.all([
    item.client_id ? db.from("clients").select("id, name").eq("organization_id", org).eq("id", item.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    item.owner_id ? db.from("users").select("display_name, full_name").eq("id", item.owner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("workflow_runs").select("id").eq("organization_id", org).eq("workflow", "renewal").eq("work_item_id", item.id).order("started_at", { ascending: false }).limit(1),
    db.from("opportunities").select("id").eq("organization_id", org).eq("work_item_id", item.id).maybeSingle(),
  ]);

  let period: RenewalLivingFacts["period"] = null;
  if (item.policy_period_id) {
    const p = await db.from("policy_periods").select("period_start, period_end, policies(policy_number, class_of_business, insurers(name))").eq("organization_id", org).eq("id", item.policy_period_id).maybeSingle();
    const row = p.data as unknown as { period_start: string; period_end: string; policies: { policy_number: string | null; class_of_business: string; insurers: { name: string } | null } | null } | null;
    if (row) period = { periodStart: row.period_start, periodEnd: row.period_end, insurerName: row.policies?.insurers?.name ?? "the insurer", policyNumber: row.policies?.policy_number ?? null, classOfBusiness: row.policies?.class_of_business ?? "Renewal" };
  }

  const runId = ((runR.data ?? []) as { id: string }[])[0]?.id ?? null;
  const perms = { canApprove: hasPermission(env.ctx, "email", "approve"), canAct: hasPermission(env.ctx, "space", "create") };
  const run = runId ? await loadWorkflowDetail(db, runId, perms) : null;

  const opportunityId = (oppR.data as { id: string } | null)?.id ?? null;
  const opportunity = opportunityId ? await quiet(loadOpportunity(db, env.ctx, org, opportunityId)) : null;

  let revisions: Revision[] = [];
  let placement: PlacementResponse | null = null;
  let issuance: IssuanceResponse | null = null;
  if (opportunityId) {
    const [revR, plR] = await Promise.all([
      db.from("insurer_response_revisions").select("insurer_response_id, revision, outcome, received_at, premium_amount, premium_currency, valid_until, source_document_id, insurer_responses(opportunity_insurers(insurers(name)))").eq("organization_id", org).eq("opportunity_id", opportunityId).order("revision"),
      db.from("placements").select("id, created_at").eq("organization_id", org).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }).limit(1),
    ]);
    revisions = ((revR.data ?? []) as unknown as { revision: number; outcome: string; received_at: string | null; premium_amount: string | null; premium_currency: string | null; valid_until: string | null; source_document_id: string | null; insurer_responses: { opportunity_insurers: { insurers: { name: string } | null } | null } | null }[]).map((r) => ({
      insurerName: r.insurer_responses?.opportunity_insurers?.insurers?.name ?? "An insurer",
      revision: r.revision,
      premiumAmount: r.premium_amount,
      premiumCurrency: r.premium_currency,
      validUntil: r.valid_until,
      outcome: r.outcome,
      receivedAt: r.received_at,
      documentId: r.source_document_id,
    }));
    const placementId = ((plR.data ?? []) as { id: string }[])[0]?.id ?? null;
    if (placementId) {
      placement = await quiet(loadPlacement(db, env.ctx, org, placementId));
      issuance = placement ? await quiet(loadIssuance(env, placementId, { readOnly: true })) : null;
    }
  }

  // What changed recently on this work, where the viewer may read the audit history.
  let recent: AuditEvent[] = [];
  if (hasPermission(env.ctx, "audit", "view")) {
    const ids = [item.id, opportunityId, placement?.placement.id].filter((x): x is string => !!x);
    const a = await db.from("audit_log").select("occurred_at, action, actor_type, actor_user_id, users(display_name, full_name)").eq("organization_id", org).in("object_id", ids).order("occurred_at", { ascending: false }).limit(12);
    recent = ((a.data ?? []) as unknown as { occurred_at: string; action: string; actor_type: string; users: { display_name: string | null; full_name: string | null } | null }[])
      .filter((x) => !/^(conversation|work_item\.step_by_run)/.test(x.action))
      .map((x) => ({ at: x.occurred_at, action: x.action, actor: x.actor_type === "user" ? (x.users?.display_name ?? x.users?.full_name ?? "A colleague") : "ASAP" }));
  }

  const owner = ownerR.data as { display_name: string | null; full_name: string | null } | null;
  return {
    item,
    client: (clientR.data as { id: string; name: string } | null) ?? null,
    period,
    ownerName: owner?.display_name ?? owner?.full_name ?? null,
    run,
    opportunity,
    revisions,
    placement,
    issuance,
    recent,
  };
}
