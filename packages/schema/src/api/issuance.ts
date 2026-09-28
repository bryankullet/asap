import { z } from "zod";
import { uuidSchema } from "./common.js";
import { evidenceRefSchema } from "./opportunities.js";
import { InstructionSource, placementWorkSchema, preparedActionSchema } from "./placement.js";

/**
 * Policy issuance (4B-5): from a placement ready for issuance to a verified policy and period.
 *
 * Nothing here carries a stored status. The stage is derived from which records exist — a frozen
 * request, an approval of its digest, evidence of submission, the insurer's document, a reviewed
 * reading, a check, resolutions, an application — so the words on screen cannot run ahead of the
 * evidence. A draft is never "sent", and nothing is "issued" until the policy record is written.
 */

export const IssuanceStage = z.enum([
  "not_ready",
  "ready",
  "approval_required",
  "submission_required",
  "with_insurer",
  "review_required",
  "differences_to_resolve",
  "ready_to_apply",
  "applied",
]);
export type IssuanceStage = z.infer<typeof IssuanceStage>;

export const IssuedClass = z.enum(["match", "changed", "missing_from_issued", "added_by_insurer", "unclear", "not_applicable"]);
export type IssuedClass = z.infer<typeof IssuedClass>;

/** Where on the insurer's document a value was read — opens at the page and the highlighted region. */
export const issuedEvidenceSchema = z.object({
  documentId: uuidSchema,
  page: z.number().int().min(1).nullable(),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
  path: z.string().max(400),
});
export type IssuedEvidence = z.infer<typeof issuedEvidenceSchema>;

/** The frozen request, as a person reads it. The digest covers the whole payload. */
export const issuanceRequestPayloadSchema = z.object({
  clientName: z.string(),
  insurerName: z.string(),
  classOfBusiness: z.string().nullable(),
  placementId: uuidSchema,
  clientInstructionId: uuidSchema,
  basisVersion: z.number().int(),
  quoteResponseId: uuidSchema,
  quoteRevisionId: uuidSchema.nullable(),
  comparisonVersion: z.number().int().nullable(),
  coverConfirmationId: uuidSchema,
  coverConfirmationReference: z.string().nullable(),
  requestedPolicyNumber: z.string().nullable(),
  inception: z.string().nullable(),
  end: z.string().nullable(),
  endBasis: z.string(),
  premiumAmount: z.string().nullable(),
  premiumCurrency: z.string().nullable(),
  premiumBasis: z.string().nullable(),
  terms: z.array(z.object({ termType: z.string(), label: z.string(), value: z.string().nullable() })),
  conditions: z.array(z.object({ text: z.string(), state: z.string() })),
  requiredDocuments: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  evidence: z.array(z.string()),
  sourceVersions: z.record(z.string(), z.unknown()),
});
export type IssuanceRequestPayload = z.infer<typeof issuanceRequestPayloadSchema>;

export const issuanceResponseSchema = z.object({
  placement: z.object({ id: uuidSchema, title: z.string() }),
  client: z.object({ id: uuidSchema, name: z.string() }),
  insurer: z.object({ id: uuidSchema, name: z.string() }),
  stage: IssuanceStage,
  /** Cover reality, from the placement's own derivation. An issuance difference never changes it. */
  cover: z.object({ state: z.string().nullable(), line: z.string() }),
  readiness: z.object({ state: z.enum(["ready", "blocked"]), reasons: z.array(z.object({ code: z.string(), message: z.string() })) }),
  request: z
    .object({
      id: uuidSchema,
      version: z.number().int(),
      sha256: z.string(),
      payload: issuanceRequestPayloadSchema,
      preparedAt: z.string(),
      preparedByName: z.string().nullable(),
      approval: z.object({ approvedByName: z.string().nullable(), approvedAt: z.string() }).nullable(),
      submission: z
        .object({
          method: z.string(),
          recipient: z.string(),
          sentAt: z.string(),
          providerMessageId: z.string().nullable(),
          evidence: evidenceRefSchema,
          recordedByName: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  requestHistory: z.array(z.object({ version: z.number().int(), preparedAt: z.string(), approvedAt: z.string().nullable(), supersededAt: z.string().nullable(), supersededReason: z.string().nullable() })),
  documents: z.array(
    z.object({
      id: uuidSchema,
      documentId: uuidSchema,
      filename: z.string(),
      receivedAt: z.string(),
      extractionState: z.string(),
      fields: z.array(z.object({
        id: uuidSchema, key: z.string(), proposedValue: z.string().nullable(), correctedValue: z.string().nullable(),
        state: z.string(), condition: z.string(), evidence: issuedEvidenceSchema.nullable(),
      })),
      terms: z.array(z.object({
        id: uuidSchema, termType: z.string(), label: z.string(), proposedValue: z.string().nullable(), correctedValue: z.string().nullable(),
        state: z.string(), reviewedFor: z.string(), evidence: issuedEvidenceSchema.nullable(),
      })),
      reviewComplete: z.boolean(),
    }),
  ),
  check: z
    .object({
      id: uuidSchema,
      current: z.boolean(),
      staleReason: z.string().nullable(),
      comparedAt: z.string(),
      comparedByName: z.string().nullable(),
      materialDifferences: z.number().int(),
      unresolved: z.number().int(),
      items: z.array(z.object({
        id: uuidSchema,
        field: z.string(),
        termType: z.string().nullable(),
        label: z.string(),
        instructionValue: z.string().nullable(),
        basisValue: z.string().nullable(),
        confirmationValue: z.string().nullable(),
        issuedValue: z.string().nullable(),
        classification: IssuedClass,
        classificationWords: z.string(),
        material: z.boolean(),
        calculation: z.string().nullable(),
        evidence: issuedEvidenceSchema.nullable(),
        resolution: z.object({ resolution: z.string(), reason: z.string(), evidence: evidenceRefSchema, resolvedByName: z.string().nullable(), resolvedAt: z.string() }).nullable(),
      })),
    })
    .nullable(),
  application: z
    .object({
      id: uuidSchema,
      targetMode: z.enum(["create", "update"]),
      policyId: uuidSchema,
      policyPeriodId: uuidSchema,
      policyNumber: z.string().nullable(),
      periodStart: z.string(),
      periodEnd: z.string(),
      appliedAt: z.string(),
      appliedByName: z.string().nullable(),
      changes: z.array(z.record(z.string(), z.unknown())),
      links: z.object({
        placementId: uuidSchema, clientInstructionId: uuidSchema, basisVersionId: uuidSchema, insurerResponseId: uuidSchema,
        coverConfirmationId: uuidSchema, documentId: uuidSchema, issuedPolicyCheckId: uuidSchema, issuanceRequestId: uuidSchema,
      }),
    })
    .nullable(),
  /** The client's existing policies a person may name as the target of an update. Never chosen for them. */
  candidates: z.array(z.object({ policyId: uuidSchema, periodId: uuidSchema, policyNumber: z.string().nullable(), periodStart: z.string(), periodEnd: z.string(), insurerName: z.string() })),
  /** This client's documents a person may name as the insurer's policy document. Never chosen for them. */
  documentOptions: z.array(z.object({ id: uuidSchema, filename: z.string(), kind: z.string(), createdAt: z.string() })),
  work: z.array(placementWorkSchema),
  blockers: z.array(z.string()),
  nextAction: z.string(),
  permissions: z.object({ canPrepare: z.boolean(), canApprove: z.boolean(), canSubmit: z.boolean(), canApply: z.boolean() }),
  sending: z.object({ available: z.boolean(), reason: z.string() }),
  preparedActions: z.array(preparedActionSchema),
});
export type IssuanceResponse = z.infer<typeof issuanceResponseSchema>;

export const issuanceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare_issuance_request"),
    requestedPolicyNumber: z.string().trim().max(100).optional(),
    requiredDocuments: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
  }),
  z.object({ action: z.literal("approve_issuance_request"), issuanceRequestId: uuidSchema }),
  z.object({
    action: z.literal("record_issuance_submission"),
    issuanceRequestId: uuidSchema,
    method: z.enum(["recorded_manual_email", "recorded_portal", "recorded_post", "recorded_in_person"]),
    recipient: z.string().trim().min(3).max(300),
    sentAt: z.string().datetime({ offset: true }),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    action: z.literal("record_issued_policy_document"),
    documentId: uuidSchema,
    receivedAt: z.string().datetime({ offset: true }),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("review_issued_field"),
    documentFieldId: uuidSchema,
    decision: z.enum(["accept", "correct", "reject"]),
    correctedValue: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal("review_issued_term"),
    proposalId: uuidSchema,
    decision: z.enum(["accept", "correct", "reject"]),
    correctedValue: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({ action: z.literal("run_issued_policy_check") }),
  z.object({
    action: z.literal("resolve_issued_policy_difference"),
    itemId: uuidSchema,
    resolution: z.enum(["client_accepted_issued_value", "confirmed_immaterial"]),
    reason: z.string().trim().min(5).max(1000),
    resolvedAt: z.string().datetime({ offset: true }),
    source: InstructionSource.optional(),
    evidenceEmailMessageId: uuidSchema.optional(),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("apply_issued_policy"),
    mode: z.enum(["create", "update"]),
    policyId: uuidSchema.optional(),
    periodId: uuidSchema.optional(),
    /** The values the person was shown in the preview. The write refuses if the record moved. */
    expected: z.record(z.string(), z.string().nullable()).optional(),
    premiumBasis: z.enum(["gross", "total_payable"]).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
]);
export type IssuanceAction = z.infer<typeof issuanceActionSchema>;

export const issuanceActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(600).nullable().default(null),
  issuance: issuanceResponseSchema.nullable().default(null),
  receipt: z.object({ message: z.string(), at: z.string() }).nullable().default(null),
});
export type IssuanceActionResponse = z.infer<typeof issuanceActionResponseSchema>;

export const applyPreviewRequestSchema = z.object({
  mode: z.enum(["create", "update"]),
  policyId: uuidSchema.optional(),
  periodId: uuidSchema.optional(),
  premiumBasis: z.enum(["gross", "total_payable"]).optional(),
});
export type ApplyPreviewRequest = z.infer<typeof applyPreviewRequestSchema>;

/** What applying will do, generated by the server before anything is written. */
export const applyPreviewSchema = z.object({
  target: z.object({ mode: z.enum(["create", "update"]), policyId: uuidSchema.nullable(), periodId: uuidSchema.nullable(), label: z.string() }),
  rows: z.array(z.object({
    field: z.string(),
    label: z.string(),
    current: z.string().nullable(),
    issued: z.string().nullable(),
    accepted: z.string().nullable(),
    evidence: issuedEvidenceSchema.nullable(),
    status: z.enum(["will_change", "unchanged", "blocked"]),
    note: z.string().nullable(),
  })),
  conflicts: z.array(z.string()),
  blocked: z.array(z.string()),
  expected: z.record(z.string(), z.string().nullable()),
  canApply: z.boolean(),
});
export type ApplyPreview = z.infer<typeof applyPreviewSchema>;
