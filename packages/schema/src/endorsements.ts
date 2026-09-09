import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * Endorsements — UI Build Spec v1 Part 6.3, v1 catalogue S08.
 *  - The insurer's partial acceptance is itemised: every requested item carries its own decision.
 *  - A rejected item stays uncovered and visible on the policy.
 *  - A confirmed change creates a new effective-dated policy version and keeps the old one.
 *  - Transfer of ownership needs the policyholder's own instruction; a request from anyone else is
 *    recorded but blocked.
 */
const isoDate = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EndorsementKind = z.enum(["add_item", "remove_item", "change_value", "transfer_ownership", "other"]);
export type EndorsementKind = z.infer<typeof EndorsementKind>;
export const RequestedBy = z.enum(["policyholder", "other"]);
export const ItemDecision = z.enum(["pending", "accepted", "rejected"]);

export const EndorsementItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Before/after in words or figures as requested; null before = new item; null after = removal. */
  before: z.string().nullable(),
  after: z.string().nullable(),
  sumInsuredMinor: z.number().int().nullable(),
  decision: ItemDecision,
  /** The insurer's note on this item, as recorded from their written response. */
  note: z.string().nullable(),
});
export type EndorsementItem = z.infer<typeof EndorsementItem>;

export const EndorsementRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  work_item_id: uuidSchema,
  policy_id: uuidSchema,
  kind: EndorsementKind.nullable(),
  requested_by: RequestedBy,
  requested_by_name: z.string().nullable(),
  request_text: z.string(),
  effective_on: day.nullable(),
  /** The policyholder's own instruction, as a reference. Required for transfer_ownership. */
  instruction_reference: z.string().nullable(),
  instruction_from: RequestedBy.nullable(),
  response_reference: z.string().nullable(),
  items: z.array(EndorsementItem),
  applied_version_id: uuidSchema.nullable(),
  created_by: uuidSchema.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type EndorsementRow = z.infer<typeof EndorsementRow>;

export const ENDORSEMENT_KIND_LABELS: Readonly<Record<EndorsementKind, string>> = {
  add_item: "Add an item",
  remove_item: "Remove an item",
  change_value: "Change a value",
  transfer_ownership: "Transfer of ownership",
  other: "Other change",
};

/** Deterministic classification from the request's own words. Null means ambiguous: ask. */
export function classifyEndorsementRequest(text: string): EndorsementKind | null {
  const t = text.toLowerCase();
  const hits: EndorsementKind[] = [];
  if (/\b(transfer|change of ownership|new owner|sold to|buyer)\b/.test(t)) hits.push("transfer_ownership");
  if (/\b(add|include|additional vehicle|new vehicle|another)\b/.test(t)) hits.push("add_item");
  if (/\b(remove|delete|take off|dispose)\b/.test(t)) hits.push("remove_item");
  if (/\b(sum insured|value|increase|decrease|reduce|raise)\b/.test(t)) hits.push("change_value");
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0]! : null;
}

/** What Check requirements (6.3 step 2) needs before the insurer can be asked. */
export function endorsementRequirementsMissing(e: Pick<EndorsementRow, "kind" | "effective_on" | "items" | "requested_by" | "instruction_from" | "instruction_reference">): string[] {
  const missing: string[] = [];
  if (!e.kind) missing.push("what kind of change this is");
  if (!e.effective_on) missing.push("the effective date");
  if (e.items.length === 0) missing.push("the items being changed");
  if (e.kind === "transfer_ownership" && !(e.instruction_from === "policyholder" && e.instruction_reference)) {
    missing.push("the policyholder's own instruction");
  }
  return missing;
}

export const TRANSFER_NEEDS_POLICYHOLDER = "Transfer of ownership needs the policyholder's own instruction.";

export const ENDORSEMENT_COLUMNS =
  "id, organization_id, work_item_id, policy_id, kind, requested_by, requested_by_name, request_text, effective_on, instruction_reference, instruction_from, response_reference, items, applied_version_id, created_by, created_at, updated_at";
