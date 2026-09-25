import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * Opportunities and the terms that come back (D-084).
 *
 * No shape here carries a status. What an opportunity has reached is derived from its own facts —
 * requirements supplied, a request approved, an insurer answered — so the words on screen cannot
 * drift from the rows they describe (D-027).
 *
 * The vocabulary is deliberately the market's, not the work layer's and not a run's: an insurer
 * **quoted**, **declined** or has **not answered**; a request is **prepared**, **approved** or
 * **sent**. None of those is a task status, a job state or a cover state.
 */

export const OpportunityClosedOutcome = z.enum(["placed", "lost", "withdrawn"]);
export type OpportunityClosedOutcome = z.infer<typeof OpportunityClosedOutcome>;

export const InsurerResponseOutcome = z.enum(["quoted", "declined", "no_response"]);
export type InsurerResponseOutcome = z.infer<typeof InsurerResponseOutcome>;

export const QuoteTermType = z.enum([
  "excess",
  "limit",
  "condition",
  "exclusion",
  "levy",
  "tax",
  "subjectivity",
  "other",
]);
export type QuoteTermType = z.infer<typeof QuoteTermType>;

/** Where a fact came from, openable. A citation that opens nothing is not a citation (§36). */
export const evidenceRefSchema = z.object({
  kind: z.enum(["document", "email", "note"]),
  id: uuidSchema.nullable(),
  label: z.string().max(300),
  path: z.string().max(300).nullable(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const opportunityRequirementSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  required: z.boolean(),
  suppliedAt: z.string().nullable(),
  suppliedByName: z.string().nullable(),
  /** What proves it. Null while it is outstanding; never null once it is supplied. */
  evidence: evidenceRefSchema.nullable(),
});
export type OpportunityRequirement = z.infer<typeof opportunityRequirementSchema>;

/**
 * What was prepared for one insurer, and how far it has got.
 *
 * `sent` is only ever true beside a provider message id. Nothing in this deployment can send, so
 * it is always false today — and the screen says exactly that rather than implying otherwise.
 */
export const quoteRequestSchema = z.object({
  id: uuidSchema,
  subject: z.string(),
  body: z.string(),
  preparedAt: z.string(),
  preparedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  sentAt: z.string().nullable(),
  sentEmailMessageId: uuidSchema.nullable(),
});
export type QuoteRequestView = z.infer<typeof quoteRequestSchema>;

export const quoteTermSchema = z.object({
  id: uuidSchema,
  termType: QuoteTermType,
  label: z.string(),
  /** What was read from the source. Never overwritten — a correction sits beside it. */
  extractedValue: z.string().nullable(),
  correctedValue: z.string().nullable(),
  correctedByName: z.string().nullable(),
  correctedAt: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  /** True when the insurer said something that cannot be compared. Not a value, and not a gap. */
  unclear: z.boolean(),
  evidence: evidenceRefSchema.nullable(),
});
export type QuoteTerm = z.infer<typeof quoteTermSchema>;

/** One insurer's place in the opportunity: approached, asked, and whatever they said back. */
export const opportunityInsurerSchema = z.object({
  id: uuidSchema,
  insurerId: uuidSchema,
  insurerName: z.string(),
  addedAt: z.string(),
  removedAt: z.string().nullable(),
  removedReason: z.string().nullable(),
  request: quoteRequestSchema.nullable(),
  response: z
    .object({
      id: uuidSchema,
      outcome: InsurerResponseOutcome,
      receivedAt: z.string().nullable(),
      premiumAmount: z.string().nullable(),
      premiumCurrency: z.string().nullable(),
      validUntil: z.string().nullable(),
      declineReason: z.string().nullable(),
      recordedByName: z.string().nullable(),
      source: evidenceRefSchema.nullable(),
      terms: z.array(quoteTermSchema),
    })
    .nullable(),
});
export type OpportunityInsurer = z.infer<typeof opportunityInsurerSchema>;

export const opportunityResponseSchema = z.object({
  opportunity: z.object({
    id: uuidSchema,
    title: z.string(),
    classOfBusiness: z.string(),
    riskSummary: z.string().nullable(),
    coverStart: z.string().nullable(),
    coverEnd: z.string().nullable(),
    ownerName: z.string().nullable(),
    createdAt: z.string(),
    closedAt: z.string().nullable(),
    closedOutcome: OpportunityClosedOutcome.nullable(),
    closedReason: z.string().nullable(),
    source: evidenceRefSchema.nullable(),
  }),
  client: z.object({ id: uuidSchema, name: z.string() }),
  workItem: z.object({
    id: uuidSchema,
    taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
    taskParty: z.string().nullable(),
    taskSince: z.string().nullable(),
  }),
  requirements: z.array(opportunityRequirementSchema),
  insurers: z.array(opportunityInsurerSchema),
  /** Every insurer of this brokerage, so one can be added without leaving the Space. */
  availableInsurers: z.array(z.object({ id: uuidSchema, name: z.string() })),
  documents: z.array(z.object({ id: uuidSchema, filename: z.string(), createdAt: z.string() })),
  permissions: z.object({
    canEdit: z.boolean(),
    canApprove: z.boolean(),
    canRecordResponse: z.boolean(),
  }),
  /**
   * Whether a prepared request can actually leave the brokerage.
   *
   * False today, with the server's own reason. An approved request that cannot be sent is said to
   * be exactly that, never implied to have gone.
   */
  sending: z.object({ available: z.boolean(), reason: z.string().max(300).nullable() }),
});
export type OpportunityResponse = z.infer<typeof opportunityResponseSchema>;

export const opportunityListResponseSchema = z.object({
  opportunities: z.array(
    z.object({
      id: uuidSchema,
      title: z.string(),
      clientId: uuidSchema,
      clientName: z.string(),
      classOfBusiness: z.string(),
      createdAt: z.string(),
      closedAt: z.string().nullable(),
      insurerCount: z.number().int().min(0),
      quotedCount: z.number().int().min(0),
    }),
  ),
});
export type OpportunityListResponse = z.infer<typeof opportunityListResponseSchema>;

/* ---- What a person may do ------------------------------------------------------------------- */

export const createOpportunityRequestSchema = z.object({
  clientId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  classOfBusiness: z.string().trim().min(1).max(100),
  riskSummary: z.string().trim().max(4000).optional(),
  coverStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  coverEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourceEmailMessageId: uuidSchema.optional(),
  sourceDocumentId: uuidSchema.optional(),
  /** The same intent retried carries the same key, so a double submit is one opportunity. */
  requestKey: uuidSchema,
});
export type CreateOpportunityRequest = z.infer<typeof createOpportunityRequestSchema>;

export const updateOpportunityRequestSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  riskSummary: z.string().trim().max(4000).nullable().optional(),
  coverStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  coverEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type UpdateOpportunityRequest = z.infer<typeof updateOpportunityRequestSchema>;

export const opportunityActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_insurer"), insurerId: uuidSchema }),
  z.object({
    action: z.literal("remove_insurer"),
    opportunityInsurerId: uuidSchema,
    reason: z.string().trim().min(1).max(300),
  }),
  z.object({ action: z.literal("add_requirement"), label: z.string().trim().min(1).max(200) }),
  z.object({
    action: z.literal("supply_requirement"),
    requirementId: uuidSchema,
    documentId: uuidSchema.optional(),
    emailMessageId: uuidSchema.optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("prepare_request"),
    opportunityInsurerId: uuidSchema,
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
  }),
  z.object({ action: z.literal("approve_request"), quoteRequestId: uuidSchema }),
  z.object({
    action: z.literal("record_response"),
    opportunityInsurerId: uuidSchema,
    outcome: InsurerResponseOutcome,
    receivedAt: z.string().datetime({ offset: true }).optional(),
    premiumAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    premiumCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    declineReason: z.string().trim().max(500).optional(),
    sourceDocumentId: uuidSchema.optional(),
    sourceEmailMessageId: uuidSchema.optional(),
    sourceNote: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("record_term"),
    insurerResponseId: uuidSchema,
    termType: QuoteTermType,
    label: z.string().trim().min(1).max(200),
    extractedValue: z.string().trim().max(500).optional(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    unclear: z.boolean().optional(),
    evidenceDocumentId: uuidSchema.optional(),
    evidencePage: z.number().int().min(1).optional(),
  }),
  z.object({
    action: z.literal("correct_term"),
    termId: uuidSchema,
    correctedValue: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("close"),
    outcome: OpportunityClosedOutcome,
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type OpportunityAction = z.infer<typeof opportunityActionSchema>;

export const opportunityActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  /** Why, when it was blocked. The guard's own words, shown beside the control (§34). */
  reason: z.string().max(300).nullable().default(null),
  opportunity: opportunityResponseSchema.nullable().default(null),
});
export type OpportunityActionResponse = z.infer<typeof opportunityActionResponseSchema>;
