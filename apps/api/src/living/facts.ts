import { WORK_ITEM_COLUMNS, WorkItemRow, type IssuanceResponse, type OpportunityResponse, type PlacementResponse, type WorkflowDetail } from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import { loadIssuance } from "../placement/issuance.js";
import { load as loadPlacement, type Env } from "../placement/service.js";
import { loadOpportunity } from "../routes/opportunities.js";
import { loadWorkflowDetail } from "../routes/workflows.js";
import { renewalWindow } from "../workflows/renewal.js";
import { loadCollaboration, type Collaboration } from "./intelligence.js";

/**
 * Everything a Living renewal surface is composed from (D-156), read under the viewer's own session
 * so RLS decides what exists for them. Each part is loaded by the module that already owns it —
 * the renewal run, the quotation, the placement, the issuance — so no business rule is re-derived
 * here: this file joins, it does not decide.
 */
export type Revision = { insurerName: string; revision: number; premiumAmount: string | null; premiumCurrency: string | null; validUntil: string | null; outcome: string; receivedAt: string | null; documentId: string | null };
export type AuditEvent = { at: string; action: string; actor: string | null };
/**
 * A source that could not be read for this viewer. "restricted": their role may not see it.
 * "failed": the read itself failed. Either way the composer must not present the gap as an absent
 * insurance fact — "no placement on file" and "the placement could not be read" are different.
 */
export type SourcePart = "client" | "owner" | "run" | "quotation" | "period" | "revisions" | "placement" | "issuance" | "history" | "memory" | "proposals";
/** One earlier period of this client's cover of the same class — what was decided before (D-162). */
export type PastPeriod = { periodStart: string; periodEnd: string; insurer: string; policyNumber: string | null; premiumAmount: string | null; premiumCurrency: string | null };
export type Unavailable = { part: SourcePart; reason: "restricted" | "failed" };

export type RenewalLivingFacts = {
  item: WorkItemRow;
  client: { id: string; name: string } | null;
  period: { periodStart: string; periodEnd: string; insurerName: string; insurerId: string | null; policyNumber: string | null; classOfBusiness: string; premiumAmount: string | null; premiumCurrency: string | null } | null;
  ownerName: string | null;
  run: WorkflowDetail | null;
  opportunity: OpportunityResponse | null;
  revisions: Revision[];
  placement: PlacementResponse | null;
  issuance: IssuanceResponse | null;
  recent: AuditEvent[];
  /** This client's earlier periods of the same class, newest first (decision memory, D-162). */
  memory: PastPeriod[];
  unavailable: Unavailable[];
  /** What the viewer's role allows on the run's controls (the endpoints check again). */
  viewer: { canControlRun: boolean };
  /** The period that follows this one on the same policy, once it is on file (stage nine, D-167). */
  renewed?: { periodStart: string; periodEnd: string; insurerName: string } | null;
  /** When the next renewal opens: the brokerage's renewal rule or ASAP's stated default. */
  window?: { leadDays: number; basis: string } | null;
  /** Saved proposals on this renewal, newest first (D-167). */
  proposals?: { version: number; savedAt: string; by: string | null; note: string | null; opportunityInsurerIds: string[]; revisions: Record<string, number | null> }[];
  /** Whether the viewer may save a proposal (job:edit, D-167). */
  canPropose?: boolean;
  /** Arrived email, handover, related work and response patterns (D-166). Absent in pure fixtures. */
  collab?: Collaboration | null;
};

/** Reads one part; a failure is recorded as a gap instead of becoming an absent fact. */
async function part<T>(gaps: Unavailable[], name: SourcePart, p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    gaps.push({ part: name, reason: e instanceof HttpError && (e.status === 403 || e.status === 404) ? "restricted" : "failed" });
    return null;
  }
}
/** A supabase-js read: an error is a gap, never "no rows". */
async function rows<T>(gaps: Unavailable[], name: SourcePart, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const r = await part(gaps, name, q);
  if (!r) return null;
  if (r.error) {
    const code = (r.error as { code?: string }).code;
    gaps.push({ part: name, reason: code === "42501" ? "restricted" : "failed" });
    return null;
  }
  return r.data as T;
}

export async function loadRenewalLivingFacts(env: Env, workItemId: string): Promise<RenewalLivingFacts> {
  const { db, organizationId: org } = env;
  const w = await db.from("work_items").select(WORK_ITEM_COLUMNS).eq("organization_id", org).eq("id", workItemId).is("deleted_at", null).maybeSingle();
  if (w.error) throw mapDatabaseError(w.error);
  if (!w.data) throw new HttpError(404, "not_found", "That work is not available.");
  const item = WorkItemRow.parse(w.data);
  if (item.kind !== "renewal") throw new HttpError(404, "not_found", "A living workspace is composed for renewals so far.");

  const gaps: Unavailable[] = [];
  const none = Promise.resolve({ data: null, error: null });
  const [clientRow, ownerRow, runRows, oppRow] = await Promise.all([
    rows<{ id: string; name: string } | null>(gaps, "client", item.client_id ? db.from("clients").select("id, name").eq("organization_id", org).eq("id", item.client_id).maybeSingle() : none),
    rows<{ display_name: string | null; full_name: string | null } | null>(gaps, "owner", item.owner_id ? db.from("users").select("display_name, full_name").eq("id", item.owner_id).maybeSingle() : none),
    rows<{ id: string }[]>(gaps, "run", db.from("workflow_runs").select("id").eq("organization_id", org).eq("workflow", "renewal").eq("work_item_id", item.id).order("started_at", { ascending: false }).limit(1)),
    rows<{ id: string } | null>(gaps, "quotation", db.from("opportunities").select("id").eq("organization_id", org).eq("work_item_id", item.id).maybeSingle()),
  ]);
  // A linked client or owner that does not come back is not "no client": it is unreadable.
  if (item.client_id && !clientRow && !gaps.some((g) => g.part === "client")) gaps.push({ part: "client", reason: "restricted" });

  let period: RenewalLivingFacts["period"] = null;
  let policyId: string | null = null;
  if (item.policy_period_id) {
    const row = await rows<{ policy_id: string; period_start: string; period_end: string; premium_amount: string | null; premium_currency: string | null; policies: { policy_number: string | null; class_of_business: string; insurer_id: string | null; insurers: { name: string } | null } | null } | null>(gaps, "period",
      db.from("policy_periods").select("period_start, period_end, premium_amount, premium_currency, policy_id, policies(policy_number, class_of_business, insurer_id, insurers(name))").eq("organization_id", org).eq("id", item.policy_period_id).maybeSingle());
    if (row) period = { periodStart: row.period_start, periodEnd: row.period_end, insurerName: row.policies?.insurers?.name ?? "the insurer", insurerId: row.policies?.insurer_id ?? null, policyNumber: row.policies?.policy_number ?? null, classOfBusiness: row.policies?.class_of_business ?? "Renewal", premiumAmount: row.premium_amount != null ? String(row.premium_amount) : null, premiumCurrency: row.premium_currency ?? null };
    else if (!gaps.some((g) => g.part === "period")) gaps.push({ part: "period", reason: "restricted" });
    policyId = row?.policy_id ?? null;
  }

  const runId = (runRows ?? [])[0]?.id ?? null;
  const perms = { canApprove: hasPermission(env.ctx, "email", "approve"), canAct: hasPermission(env.ctx, "space", "create") };
  const run = runId ? await part(gaps, "run", loadWorkflowDetail(db, runId, perms)) : null;

  const opportunityId = oppRow?.id ?? null;
  const opportunity = opportunityId ? await part(gaps, "quotation", loadOpportunity(db, env.ctx, org, opportunityId)) : null;

  let revisions: Revision[] = [];
  let placement: PlacementResponse | null = null;
  let issuance: IssuanceResponse | null = null;
  if (opportunityId) {
    const [revData, plData] = await Promise.all([
      rows<unknown[]>(gaps, "revisions", db.from("insurer_response_revisions").select("insurer_response_id, revision, outcome, received_at, premium_amount, premium_currency, valid_until, source_document_id, insurer_responses(opportunity_insurers(insurers(name)))").eq("organization_id", org).eq("opportunity_id", opportunityId).order("revision")),
      rows<{ id: string }[]>(gaps, "placement", db.from("placements").select("id, created_at").eq("organization_id", org).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }).limit(1)),
    ]);
    revisions = ((revData ?? []) as unknown as { revision: number; outcome: string; received_at: string | null; premium_amount: string | null; premium_currency: string | null; valid_until: string | null; source_document_id: string | null; insurer_responses: { opportunity_insurers: { insurers: { name: string } | null } | null } | null }[]).map((r) => ({
      insurerName: r.insurer_responses?.opportunity_insurers?.insurers?.name ?? "An insurer",
      revision: r.revision,
      premiumAmount: r.premium_amount,
      premiumCurrency: r.premium_currency,
      validUntil: r.valid_until,
      outcome: r.outcome,
      receivedAt: r.received_at,
      documentId: r.source_document_id,
    }));
    const placementId = (plData ?? [])[0]?.id ?? null;
    if (placementId) {
      placement = await part(gaps, "placement", loadPlacement(db, env.ctx, org, placementId));
      issuance = placement ? await part(gaps, "issuance", loadIssuance(env, placementId, { readOnly: true })) : null;
    }
  }

  // The remaining parts are independent of each other and read together (D-168).
  const recentP = (async (): Promise<AuditEvent[]> => {
    // What changed recently on this work, where the viewer may read the audit history.
    if (!hasPermission(env.ctx, "audit", "view")) return [];
    const ids = [item.id, opportunityId, placement?.placement.id].filter((x): x is string => !!x);
    const a = await rows<unknown[]>(gaps, "history", db.from("audit_log").select("occurred_at, action, actor_type, actor_user_id, users(display_name, full_name)").eq("organization_id", org).in("object_id", ids).order("occurred_at", { ascending: false }).limit(12));
    return ((a ?? []) as unknown as { occurred_at: string; action: string; actor_type: string; users: { display_name: string | null; full_name: string | null } | null }[])
      .filter((x) => !/^(conversation|work_item\.step_by_run)/.test(x.action))
      .map((x) => ({ at: x.occurred_at, action: x.action, actor: x.actor_type === "user" ? (x.users?.display_name ?? x.users?.full_name ?? "A colleague") : "ASAP" }));
  })();

  const memoryP = (async (): Promise<PastPeriod[]> => {
    // What was decided before: earlier periods of this client's cover of the same class, under RLS.
    if (!item.client_id || !period) return [];
    // The client's policies of this class first, then their periods by id: an embedded-join filter
    // is evaluated row by row under RLS across the whole brokerage (D-168).
    const pols = await rows<{ id: string; policy_number: string | null; insurers: { name: string } | null }[]>(gaps, "memory",
      db.from("policies").select("id, policy_number, insurers(name)").eq("organization_id", org).eq("client_id", item.client_id).eq("class_of_business", period.classOfBusiness).is("deleted_at", null).limit(200));
    const ids = (pols ?? []).map((p) => p.id);
    const raw = ids.length
      ? await rows<{ policy_id: string; period_start: string; period_end: string; premium_amount: string | null; premium_currency: string | null }[]>(gaps, "memory",
          db.from("policy_periods").select("policy_id, period_start, period_end, premium_amount, premium_currency").eq("organization_id", org).in("policy_id", ids).lt("period_end", period.periodEnd).order("period_end", { ascending: false }).limit(5))
      : [];
    return (raw ?? []).map((r) => {
      const p = pols!.find((x) => x.id === r.policy_id)!;
      return { periodStart: r.period_start, periodEnd: r.period_end, insurer: p.insurers?.name ?? "An insurer", policyNumber: p.policy_number, premiumAmount: r.premium_amount != null ? String(r.premium_amount) : null, premiumCurrency: r.premium_currency };
    });
  })();

  const waitingOn = (opportunity?.insurers ?? []).filter((i) => !i.removedAt && i.request && (i.request.sentAt || i.request.delivery) && !i.response).map((i) => i.insurerName);
  const collabP = loadCollaboration(env, [], { item, subjectIds: [opportunityId ?? "", placement?.placement.id ?? ""], policyId, waitingOn, canRecordResponse: Boolean(opportunity?.permissions.canRecordResponse),
    trailFor: item.client_id && period ? { clientId: item.client_id, classOfBusiness: period.classOfBusiness, excludeOpportunityId: opportunityId } : null });

  type Renewed = { periodStart: string; periodEnd: string; insurerName: string };
  const renewedP = (async (): Promise<{ renewed: Renewed | null; win: { leadDays: number; basis: string } | null }> => {
    // Stage nine: the following period on the same policy, and when its renewal would open.
    if (!policyId || !period) return { renewed: null, win: null };
    const [r, w] = await Promise.all([
      rows<{ period_start: string; period_end: string; policies: { insurers: { name: string } | null } | null }[]>(gaps, "period",
        db.from("policy_periods").select("period_start, period_end, policies(insurers(name))").eq("organization_id", org).eq("policy_id", policyId).gt("period_start", period.periodStart).order("period_start").limit(1)),
      renewalWindow(db, org).catch(() => null),
    ]);
    const n = r?.[0];
    return { renewed: n ? { periodStart: n.period_start, periodEnd: n.period_end, insurerName: n.policies?.insurers?.name ?? period.insurerName } : null, win: n && w ? { leadDays: w.leadDays, basis: w.basis } : null };
  })();

  const proposalsP = (async () => {
    if (!opportunityId) return [];
    const rowsP = await rows<{ version: number; created_at: string; note: string | null; opportunity_insurer_ids: string[]; revisions: Record<string, number | null>; users: { display_name: string | null; full_name: string | null } | null }[]>(gaps, "proposals",
      db.from("renewal_proposals").select("version, created_at, note, opportunity_insurer_ids, revisions, users!renewal_proposals_created_by_fkey(display_name, full_name)").eq("organization_id", org).eq("work_item_id", item.id).order("version", { ascending: false }).limit(12));
    return (rowsP ?? []).map((p) => ({ version: p.version, savedAt: p.created_at, by: p.users?.display_name ?? p.users?.full_name ?? null, note: p.note, opportunityInsurerIds: p.opportunity_insurer_ids, revisions: p.revisions }));
  })();

  const [recent, memory, collab, { renewed, win }, proposals] = await Promise.all([recentP, memoryP, collabP, renewedP, proposalsP]);

  const owner = ownerRow;
  return {
    item,
    client: clientRow ?? null,
    period,
    ownerName: owner?.display_name ?? owner?.full_name ?? null,
    run,
    opportunity,
    revisions,
    placement,
    issuance,
    recent,
    memory,
    unavailable: gaps,
    viewer: { canControlRun: hasPermission(env.ctx, "policy", "edit") },
    collab,
    renewed,
    proposals,
    canPropose: hasPermission(env.ctx, "job", "edit"),
    window: win,
  };
}
