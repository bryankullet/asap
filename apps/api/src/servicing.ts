import {
  CLAIM_COLUMNS,
  CLAIM_DOCUMENT_COLUMNS,
  CLAIM_NOTE_COLUMNS,
  ClaimDocumentRow,
  ClaimNoteRow,
  ClaimRow,
  ENDORSEMENT_COLUMNS,
  EndorsementRow,
  INSURER_COLUMNS,
  InsurerRow,
  POLICY_COLUMNS,
  POLICY_PERIOD_COLUMNS,
  POLICY_VERSION_COLUMNS,
  PolicyPeriodRow,
  PolicyRow,
  PolicyVersionRow,
  clockState,
  endorsementRequirementsMissing,
  type ClaimDetail,
  type EndorsementDetail,
  type PolicyResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, mapDatabaseError } from "./errors.js";

/** Reads for claims, endorsements and policies, under the caller's session (RLS applies). */

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function loadClaimDetail(
  db: SupabaseClient,
  workItemId: string,
  now = new Date(),
): Promise<ClaimDetail | null> {
  const claimR = await db
    .from("claims")
    .select(CLAIM_COLUMNS)
    .eq("work_item_id", workItemId)
    .maybeSingle();
  if (claimR.error) throw mapDatabaseError(claimR.error);
  if (!claimR.data) return null;
  const claim = ClaimRow.parse(claimR.data);
  const [docsR, notesR, policiesR] = await Promise.all([
    db
      .from("claim_documents")
      .select(CLAIM_DOCUMENT_COLUMNS)
      .eq("claim_id", claim.id)
      .order("created_at"),
    db.from("claim_notes").select(CLAIM_NOTE_COLUMNS).eq("claim_id", claim.id).order("noted_at"),
    db
      .from("policies")
      .select(POLICY_COLUMNS)
      .eq("client_id", claim.client_id)
      .is("deleted_at", null),
  ]);
  for (const r of [docsR, notesR, policiesR]) if (r.error) throw mapDatabaseError(r.error);
  const policies = PolicyRow.array().parse(policiesR.data ?? []);
  const candidatePeriods: ClaimDetail["candidatePeriods"] = [];
  if (policies.length > 0) {
    const ids = policies.map((p) => p.id);
    const [periodsR, insurersR] = await Promise.all([
      db
        .from("policy_periods")
        .select(POLICY_PERIOD_COLUMNS)
        .in("policy_id", ids)
        .order("period_start"),
      db
        .from("insurers")
        .select(INSURER_COLUMNS)
        .in("id", [...new Set(policies.map((p) => p.insurer_id))]),
    ]);
    if (periodsR.error) throw mapDatabaseError(periodsR.error);
    if (insurersR.error) throw mapDatabaseError(insurersR.error);
    const insurers = InsurerRow.array().parse(insurersR.data ?? []);
    for (const period of PolicyPeriodRow.array().parse(periodsR.data ?? [])) {
      // Only periods that contain the incident date are candidates; two → the person chooses.
      if (period.period_start > claim.incident_on || period.period_end < claim.incident_on)
        continue;
      const policy = policies.find((p) => p.id === period.policy_id)!;
      candidatePeriods.push({
        period,
        policy,
        insurerName: insurers.find((i) => i.id === policy.insurer_id)?.name ?? "the insurer",
      });
    }
  }
  return {
    claim,
    documents: ClaimDocumentRow.array().parse(docsR.data ?? []),
    notes: ClaimNoteRow.array().parse(notesR.data ?? []),
    clock: clockState(claim, today(now)),
    candidatePeriods,
  };
}

export async function loadEndorsementDetail(
  db: SupabaseClient,
  workItemId: string,
): Promise<EndorsementDetail | null> {
  const eR = await db
    .from("endorsements")
    .select(ENDORSEMENT_COLUMNS)
    .eq("work_item_id", workItemId)
    .maybeSingle();
  if (eR.error) throw mapDatabaseError(eR.error);
  if (!eR.data) return null;
  const endorsement = EndorsementRow.parse(eR.data);
  const [pR, vR] = await Promise.all([
    db.from("policies").select(POLICY_COLUMNS).eq("id", endorsement.policy_id).maybeSingle(),
    db
      .from("policy_versions")
      .select(POLICY_VERSION_COLUMNS)
      .eq("policy_id", endorsement.policy_id)
      .order("version"),
  ]);
  if (pR.error) throw mapDatabaseError(pR.error);
  if (vR.error) throw mapDatabaseError(vR.error);
  if (!pR.data) throw new HttpError(404, "not_found");
  return {
    endorsement,
    policy: PolicyRow.parse(pR.data),
    versions: PolicyVersionRow.array().parse(vR.data ?? []),
    missing: endorsementRequirementsMissing(endorsement),
  };
}

export async function loadPolicy(db: SupabaseClient, id: string): Promise<PolicyResponse | null> {
  const pR = await db
    .from("policies")
    .select(POLICY_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (pR.error) throw mapDatabaseError(pR.error);
  if (!pR.data) return null;
  const policy = PolicyRow.parse(pR.data);
  const [cR, iR, perR, vR] = await Promise.all([
    db.from("clients").select("id, name").eq("id", policy.client_id).maybeSingle(),
    db.from("insurers").select("id, name").eq("id", policy.insurer_id).maybeSingle(),
    db
      .from("policy_periods")
      .select(POLICY_PERIOD_COLUMNS)
      .eq("policy_id", id)
      .order("period_start"),
    db.from("policy_versions").select(POLICY_VERSION_COLUMNS).eq("policy_id", id).order("version"),
  ]);
  for (const r of [cR, iR, perR, vR]) if (r.error) throw mapDatabaseError(r.error);
  return {
    policy,
    clientName: (cR.data as { name: string } | null)?.name ?? "Client",
    insurerName: (iR.data as { name: string } | null)?.name ?? "Insurer",
    periods: PolicyPeriodRow.array().parse(perR.data ?? []),
    versions: PolicyVersionRow.array().parse(vR.data ?? []),
  };
}

/** Policies of a client, with their insurer names, for endorsement creation from Ask. */
export async function clientPolicies(
  db: SupabaseClient,
  clientId: string,
): Promise<{ policy: PolicyRow; insurerName: string }[]> {
  const pR = await db
    .from("policies")
    .select(POLICY_COLUMNS)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at");
  if (pR.error) throw mapDatabaseError(pR.error);
  const policies = PolicyRow.array().parse(pR.data ?? []);
  if (policies.length === 0) return [];
  const iR = await db
    .from("insurers")
    .select("id, name")
    .in("id", [...new Set(policies.map((p) => p.insurer_id))]);
  if (iR.error) throw mapDatabaseError(iR.error);
  const names = new Map(
    ((iR.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  return policies.map((policy) => ({
    policy,
    insurerName: names.get(policy.insurer_id) ?? "the insurer",
  }));
}
