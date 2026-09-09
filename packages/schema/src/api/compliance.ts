import { z } from "zod";
import {
  AgreementRateRow,
  AgreementRow,
  AgreementVersionRow,
  InsurerRow,
  RateProposer,
} from "../agreements.js";
import { ClientDocumentRow, ClientKind, ClientRow, DocumentKind, K01View } from "../compliance.js";
import { FileStatus } from "../status.js";
import { WorkItemRow } from "../work.js";
import { uuidSchema } from "./common.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** K01 — one row per client with what its file is blocking. */
export const clientFileListItemSchema = z.object({
  client: ClientRow,
  effective_status: FileStatus,
  blocking: z.array(z.object({ id: uuidSchema, title: z.string(), step: z.string() })),
  in_state_since: z.string(),
  documents_held: z.number().int(),
});
export const clientFilesResponseSchema = z.object({
  view: K01View,
  items: z.array(clientFileListItemSchema),
  counts: z.record(K01View, z.number().int()),
});
export type ClientFilesResponse = z.infer<typeof clientFilesResponseSchema>;

/** K02 */
export const clientFileResponseSchema = z.object({
  client: ClientRow,
  effective_status: FileStatus,
  documents: z.array(ClientDocumentRow),
  blocking: z.array(z.object({ id: uuidSchema, title: z.string(), step: z.string() })),
  screening: z.object({ available: z.literal(false), reason: z.string() }),
  /** What is still missing before the file can be cleared. */
  missing: z.array(z.string()),
});
export type ClientFileResponse = z.infer<typeof clientFileResponseSchema>;

/** H05 create path. Duplicate review: plausible existing clients are returned first; `confirmNew` creates anyway. */
export const createClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: ClientKind,
  confirmNew: z.boolean().default(false),
});
export const createClientResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("created"), file: clientFileResponseSchema }),
  z.object({
    outcome: z.literal("possible_duplicates"),
    name: z.string(),
    candidates: z.array(z.object({ id: uuidSchema, name: z.string(), kind: ClientKind })),
  }),
]);
export type CreateClientResponse = z.infer<typeof createClientResponseSchema>;

export const clientFileActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_document"),
    kind: DocumentKind,
    label: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("record_document"),
    kind: DocumentKind,
    label: z.string().trim().min(1).max(200),
    reference: z.string().trim().min(1).max(500),
    receivedAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ action: z.literal("start_review") }),
  z.object({
    action: z.literal("clear"),
    reason: z.string().trim().min(1).max(1000),
    refreshIntervalDays: z.number().int().min(30).max(1825),
  }),
  z.object({ action: z.literal("reopen"), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("screen") }),
]);
export type ClientFileAction = z.infer<typeof clientFileActionSchema>;

export const clientFileActionResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), file: clientFileResponseSchema }),
  z.object({
    outcome: z.literal("blocked"),
    guard: z.string(),
    reason: z.string(),
    file: clientFileResponseSchema,
  }),
]);

/** G01 */
export const agreementsResponseSchema = z.object({
  rows: z.array(
    z.object({
      insurer: InsurerRow,
      agreement: AgreementRow.nullable(),
      current_version: AgreementVersionRow.nullable(),
      confirmed_classes: z.array(z.string()),
      unconfirmed_classes: z.array(z.string()),
      /** Live work for this insurer whose class has no confirmed rate. */
      undocumented_live: z.array(
        z.object({ id: uuidSchema, title: z.string(), class_of_business: z.string() }),
      ),
    }),
  ),
  /** The number that matters (Screen Map v3 G01): live items expecting commission with no documented rate. */
  undocumented_total: z.number().int(),
});
export type AgreementsResponse = z.infer<typeof agreementsResponseSchema>;

/** G02 */
export const agreementResponseSchema = z.object({
  insurer: InsurerRow,
  agreement: AgreementRow,
  versions: z.array(z.object({ version: AgreementVersionRow, rates: z.array(AgreementRateRow) })),
});
export type AgreementResponse = z.infer<typeof agreementResponseSchema>;

export const agreementActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_insurer"), name: z.string().trim().min(1).max(200) }),
  z.object({
    action: z.literal("create_agreement"),
    insurerId: uuidSchema,
    effectiveFrom: day,
    documentReference: z.string().trim().max(500).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    action: z.literal("new_version"),
    agreementId: uuidSchema,
    effectiveFrom: day,
    documentReference: z.string().trim().max(500).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("propose_rate"),
    versionId: uuidSchema,
    classOfBusiness: z.string().trim().min(1).max(100),
    rateBasisPoints: z.number().int().min(0).max(10_000),
    clauseReference: z.string().trim().max(200).optional(),
    proposedBy: RateProposer,
  }),
  z.object({ action: z.literal("confirm_rate"), rateId: uuidSchema }),
]);
export type AgreementAction = z.infer<typeof agreementActionSchema>;

export const agreedRateSchema = z
  .object({
    rate_basis_points: z.number().int(),
    clause_reference: z.string().nullable(),
    version: z.number().int(),
    effective_from: day,
  })
  .nullable();
export type AgreedRate = z.infer<typeof agreedRateSchema>;

/** Placement from Ask or K02: creates the item; the gate is evaluated at approval. */
export const createPlacementRequestSchema = z.object({
  kind: z.literal("placement"),
  clientId: uuidSchema,
  insurerId: uuidSchema,
  classOfBusiness: z.string().trim().min(1).max(100),
});
export const placementCreatedSchema = z.object({ item: WorkItemRow, reopened: z.boolean() });
