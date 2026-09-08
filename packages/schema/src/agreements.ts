import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * Agency agreements — Screen Map v3 Part 4.2 (G01, G02). One agreement per insurer, versioned;
 * a rate proposed by ASAP or a person becomes usable only once a person confirms it. Policies
 * rated under an old version keep it; history is never rewritten.
 */
const isoDate = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const InsurerRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string().min(1),
  created_at: isoDate,
  updated_at: isoDate,
  deleted_at: isoDate.nullable(),
});
export type InsurerRow = z.infer<typeof InsurerRow>;

export const AgreementStatus = z.enum(["draft", "active", "expired"]);

export const AgreementRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  insurer_id: uuidSchema,
  status: AgreementStatus,
  document_reference: z.string().nullable(),
  created_by: uuidSchema.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
  deleted_at: isoDate.nullable(),
});
export type AgreementRow = z.infer<typeof AgreementRow>;

export const AgreementVersionRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  agreement_id: uuidSchema,
  version: z.number().int(),
  effective_from: day,
  effective_to: day.nullable(),
  payment_terms_days: z.number().int().nullable(),
  document_reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: uuidSchema.nullable(),
  created_at: isoDate,
});
export type AgreementVersionRow = z.infer<typeof AgreementVersionRow>;

export const RateProposer = z.enum(["asap", "person"]);

export const AgreementRateRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  version_id: uuidSchema,
  class_of_business: z.string().min(1),
  /** Basis points of the commission basis (Part 3: base premium, not gross). 1500 = 15%. */
  rate_basis_points: z.number().int().min(0).max(10_000),
  clause_reference: z.string().nullable(),
  proposed_by: RateProposer,
  proposed_by_user: uuidSchema.nullable(),
  confirmed_by: uuidSchema.nullable(),
  confirmed_at: isoDate.nullable(),
  created_at: isoDate,
});
export type AgreementRateRow = z.infer<typeof AgreementRateRow>;

export const NO_AGREED_RATE = "No agreed rate on file for this class.";

export const INSURER_COLUMNS = "id, organization_id, name, created_at, updated_at, deleted_at";
export const AGREEMENT_COLUMNS =
  "id, organization_id, insurer_id, status, document_reference, created_by, created_at, updated_at, deleted_at";
export const AGREEMENT_VERSION_COLUMNS =
  "id, organization_id, agreement_id, version, effective_from, effective_to, payment_terms_days, document_reference, notes, created_by, created_at";
export const AGREEMENT_RATE_COLUMNS =
  "id, organization_id, version_id, class_of_business, rate_basis_points, clause_reference, proposed_by, proposed_by_user, confirmed_by, confirmed_at, created_at";
