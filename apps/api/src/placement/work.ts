import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Placement Work: why it is in Work, what to do, who has it, since when, and what happens next.
 *
 * Every reason is server-owned copy in one catalogue, so a Work card reads the same wherever it
 * appears and nothing in the browser composes it. Identity is the placement and the reason code —
 * never the title — and the database's partial unique index refuses a second open item for the
 * same placement and reason (0055). Two placements with the same title are two sources, so two
 * items; completing one cannot complete the other.
 *
 * Exactly one lifecycle reason is open per placement at a time. `syncPlacementWork` derives which
 * one the facts call for, completes any other, and ensures that one — so a resolved blocker is
 * completed and the next is created once, in the same call.
 */

export type PlacementReason =
  | "quote_moved"
  | "prepare_request"
  | "approval_required"
  | "submission_proof_missing"
  | "awaiting_insurer"
  | "insurer_needs_information"
  | "insurer_declined"
  | "verify_cover_match"
  | "review_changed_terms"
  | "clarify_changes"
  | "resolve_rejected_changes"
  | "issue_policy";

export const ALL_REASONS: PlacementReason[] = [
  "quote_moved",
  "prepare_request",
  "approval_required",
  "submission_proof_missing",
  "awaiting_insurer",
  "insurer_needs_information",
  "insurer_declined",
  "verify_cover_match",
  "review_changed_terms",
  "clarify_changes",
  "resolve_rejected_changes",
  "issue_policy",
];

type Copy = {
  /** Follows the task-status label in the headline: "Your work — approve placement request". */
  headline: string;
  why: string;
  action: string;
  evidence: string;
  after: string;
};

export const REASON_COPY: Record<PlacementReason, Copy> = {
  quote_moved: {
    headline: "review what changed in the quotation",
    why: "The insurer revised the quotation after the client accepted it.",
    action: "Review each change, and record the client's instruction again where it matters.",
    evidence: "A new client instruction, if the change is material.",
    after: "The placement can be prepared again on the terms the client accepts.",
  },
  prepare_request: {
    headline: "prepare the placement request",
    why: "The client has instructed, and nothing has been prepared for the insurer yet.",
    action: "Prepare the placement request from the frozen terms.",
    evidence: "None — a draft is not sent.",
    after: "Someone permitted approves that exact version.",
  },
  approval_required: {
    headline: "approve placement request",
    why: "A placement request is prepared and nobody permitted has approved it.",
    action: "Approve the current version of the request.",
    evidence: "Approval by someone who may approve placements.",
    after: "It can be sent, and the sending recorded.",
  },
  submission_proof_missing: {
    headline: "send the approved request and record how",
    why: "The request is approved but there is no evidence it reached the insurer.",
    action: "Send it yourself — sending from ASAP is not connected — then record how, to whom and when.",
    evidence: "The sent message, or a note of when, from which mailbox and to whom.",
    after: "The insurer holds it, and Work names them with the date.",
  },
  awaiting_insurer: {
    headline: "cover confirmation requested",
    why: "The request was sent and the insurer has not answered.",
    action: "Record the insurer's answer when it arrives, with its evidence.",
    evidence: "The insurer's confirmation, decline or query.",
    after: "The confirmation is checked against what the client accepted.",
  },
  insurer_needs_information: {
    headline: "supply what the insurer asked for",
    why: "The insurer needs more information before it will confirm.",
    action: "Send the insurer what it asked for, then record its answer.",
    evidence: "What was supplied, and the insurer's answer.",
    after: "The insurer confirms, declines or asks again.",
  },
  insurer_declined: {
    headline: "take the client's instruction on another quote",
    why: "The insurer declined. There is no cover from this placement.",
    action: "Return to the comparison and take the client's instruction on another quote.",
    evidence: "A new client instruction.",
    after: "A new placement is opened with the insurer the client chooses.",
  },
  verify_cover_match: {
    headline: "check the confirmation against what was agreed",
    why: "The confirmation has not been compared with the terms the client accepted.",
    action: "Run the cover check.",
    evidence: "None — ASAP compares the two records.",
    after: "Any difference is listed field by field.",
  },
  review_changed_terms: {
    headline: "review changed insurer terms",
    why: "The insurer confirmed cover on terms that differ from what the client accepted.",
    action: "Review each difference, put them to the client, and record the client's decision.",
    evidence: "The client's decision on the changes, and how it arrived.",
    after: "If the client accepts, what was agreed is updated and checked again.",
  },
  clarify_changes: {
    headline: "clarify the terms the client queried",
    why: "The client accepted some of the insurer's changes and asked about others.",
    action: "Clarify the queried terms with the insurer or the client, then record the client's decision.",
    evidence: "The client's decision on the remaining changes.",
    after: "A full acceptance updates what was agreed.",
  },
  resolve_rejected_changes: {
    headline: "resolve the rejected changes with the insurer",
    why: "The client rejected the insurer's changes. The insurer's cover stands as confirmed.",
    action: "Ask the insurer to confirm on the terms requested, or take the client's instruction again.",
    evidence: "The insurer's revised confirmation, or a new client instruction.",
    after: "A confirmation on the agreed terms makes policy issuance possible.",
  },
  issue_policy: {
    headline: "issue policy from confirmed cover",
    why: "Cover is confirmed and matches what the client accepted.",
    action: "Issue the policy from the insurer's confirmation.",
    evidence: "The insurer's policy schedule, when it arrives.",
    after: "The policy is recorded in 4B-5.",
  },
};

export type WorkTarget = {
  reason: PlacementReason;
  status: "needs_you" | "with_party";
  party: string | null;
  since: string | null;
  owner: string | null;
};

export type WorkContext = {
  organizationId: string;
  placementId: string;
  placementTitle: string;
  clientId: string;
  insurerId: string;
  classOfBusiness: string;
};

export function workTitle(placementTitle: string, reason: PlacementReason): string {
  return `${placementTitle}: ${REASON_COPY[reason].headline}`;
}

/** Ensure one open item for this placement and reason. A retry refreshes it; never duplicates. */
export async function ensureWork(db: SupabaseClient, w: WorkContext, t: WorkTarget): Promise<string | null> {
  const copy = REASON_COPY[t.reason];
  const { data, error } = await db.rpc("work_item_ensure", {
    p_organization_id: w.organizationId,
    p_source_type: "placement",
    p_source_id: w.placementId,
    p_reason_code: t.reason,
    p_kind: "placement",
    p_title: workTitle(w.placementTitle, t.reason),
    p_reason: copy.why,
    p_required_action: copy.action,
    p_evidence_needed: copy.evidence,
    p_task_status: t.status,
    p_task_party: t.party,
    p_task_since: t.since,
    p_task_next_check: null,
    p_owner_id: t.owner,
    p_client_id: w.clientId,
    p_insurer_id: w.insurerId,
    p_class_of_business: w.classOfBusiness,
  });
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

export async function resolveWork(db: SupabaseClient, organizationId: string, placementId: string, reason: PlacementReason) {
  await db.rpc("work_item_resolve", {
    p_organization_id: organizationId,
    p_source_type: "placement",
    p_source_id: placementId,
    p_reason_code: reason,
  });
}

export type OpenWork = {
  id: string;
  reason: PlacementReason;
  taskStatus: "needs_you" | "with_party" | "in_progress" | "done";
  taskParty: string | null;
  taskSince: string | null;
  taskNextCheck: string | null;
  ownerId: string | null;
};

export async function openWorkFor(db: SupabaseClient, organizationId: string, placementId: string): Promise<OpenWork[]> {
  const { data } = await db
    .from("work_items")
    .select("id, reason_code, task_status, task_party, task_since, task_next_check, owner_id")
    .eq("organization_id", organizationId)
    .eq("source_type", "placement")
    .eq("source_id", placementId)
    .neq("task_status", "done")
    .is("deleted_at", null);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => ALL_REASONS.includes(r["reason_code"] as PlacementReason))
    .map((r) => ({
      id: r["id"] as string,
      reason: r["reason_code"] as PlacementReason,
      taskStatus: r["task_status"] as OpenWork["taskStatus"],
      taskParty: (r["task_party"] as string | null) ?? null,
      taskSince: (r["task_since"] as string | null) ?? null,
      taskNextCheck: (r["task_next_check"] as string | null) ?? null,
      ownerId: (r["owner_id"] as string | null) ?? null,
    }));
}

/**
 * Make Work say what the facts say. Completes every open placement reason except the one the
 * facts call for, and ensures that one. Writes nothing when Work already agrees, so reading a
 * placement does not fill the audit trail with refreshes.
 */
export async function syncPlacementWork(
  db: SupabaseClient,
  w: WorkContext,
  target: WorkTarget | null,
): Promise<OpenWork[]> {
  const open = await openWorkFor(db, w.organizationId, w.placementId);
  for (const item of open) {
    if (target === null || item.reason !== target.reason) {
      await resolveWork(db, w.organizationId, w.placementId, item.reason);
    }
  }
  if (target !== null) {
    const current = open.find((i) => i.reason === target.reason);
    const agrees =
      current !== undefined &&
      current.taskStatus === target.status &&
      current.taskParty === target.party &&
      (target.owner === null || current.ownerId === target.owner);
    if (!agrees) await ensureWork(db, w, target);
  }
  return openWorkFor(db, w.organizationId, w.placementId);
}
