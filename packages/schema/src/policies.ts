import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * Policies — the insurer's contract — with effective-dated versions. A confirmed endorsement
 * creates a new version and keeps the old one; the current version is the one effective on a
 * date, never "the latest row". `policy_periods` is the thin client-policy-year table decided in
 * D-029 (option B): id, policy, dates, nothing else.
 */
const isoDate = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PolicyItemStatus = z.enum(["in_force", "rejected_by_insurer", "removed"]);

/** A scheduled item (a vehicle, a location, a sum insured line). Sums are integer minor units. */
export const PolicyItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sumInsuredMinor: z.number().int().nullable(),
  covered: z.boolean(),
  status: PolicyItemStatus,
  /** Why an item is not covered, in the insurer's or the person's words as recorded. */
  note: z.string().nullable(),
});
export type PolicyItem = z.infer<typeof PolicyItem>;

export const PolicyRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  client_id: uuidSchema,
  insurer_id: uuidSchema,
  class_of_business: z.string().min(1),
  policy_number: z.string().nullable(),
  created_at: isoDate,
  updated_at: isoDate,
  deleted_at: isoDate.nullable(),
});
export type PolicyRow = z.infer<typeof PolicyRow>;

export const PolicyPeriodRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  policy_id: uuidSchema,
  period_start: day,
  period_end: day,
  created_at: isoDate,
});
export type PolicyPeriodRow = z.infer<typeof PolicyPeriodRow>;

export const PolicyVersionSource = z.enum(["placement", "endorsement", "import", "seed"]);

export const PolicyVersionRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  policy_id: uuidSchema,
  version: z.number().int(),
  effective_from: day,
  effective_to: day.nullable(),
  source: PolicyVersionSource,
  endorsement_id: uuidSchema.nullable(),
  items: z.array(PolicyItem),
  created_by: uuidSchema.nullable(),
  created_at: isoDate,
});
export type PolicyVersionRow = z.infer<typeof PolicyVersionRow>;

/** The version effective on a day, or null. Versions are kept; only the dates decide. */
export function versionOn(versions: readonly PolicyVersionRow[], on: string): PolicyVersionRow | null {
  const hits = versions.filter((v) => v.effective_from <= on && (v.effective_to === null || v.effective_to >= on));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.version > a.version ? b : a));
}

export const POLICY_COLUMNS = "id, organization_id, client_id, insurer_id, class_of_business, policy_number, created_at, updated_at, deleted_at";
export const POLICY_PERIOD_COLUMNS = "id, organization_id, policy_id, period_start, period_end, created_at";
export const POLICY_VERSION_COLUMNS =
  "id, organization_id, policy_id, version, effective_from, effective_to, source, endorsement_id, items, created_by, created_at";
