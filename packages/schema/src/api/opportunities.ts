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

/* ---- Comparing what came back ---------------------------------------------------------------
 *
 * A comparison is a photograph of the market at one moment, so everything here is about whether
 * the photograph still describes anything: what it was taken from, what has moved since, and what
 * was never there to photograph.
 */

/** Why a comparison is not worth making yet. Each is a sentence a broker can act on. */
export const comparisonReadinessSchema = z.object({
  ready: z.boolean(),
  /** Empty when ready. Never a bare "Waiting" — each names who or what is outstanding. */
  blockers: z.array(z.string().max(300)),
  approached: z.number().int().min(0),
  quoted: z.number().int().min(0),
  declined: z.number().int().min(0),
  awaiting: z.array(z.object({ insurerName: z.string(), since: z.string().nullable() })),
  /** Required information the client has not supplied. A quote compared without it is a guess. */
  missingInformation: z.array(z.string().max(200)),
});
export type ComparisonReadiness = z.infer<typeof comparisonReadinessSchema>;

/** One thing that has moved since the comparison was made, named by insurer and by term. */
export const comparisonChangeSchema = z.object({
  insurerId: uuidSchema,
  insurerName: z.string(),
  termType: QuoteTermType.nullable(),
  label: z.string().nullable(),
  change: z.string().max(300),
});
export type ComparisonChange = z.infer<typeof comparisonChangeSchema>;

/**
 * One insurer's cell on one row.
 *
 * The three absences are different things and are never collapsed into a blank: `missing` is
 * "this insurer did not state it", `unclear` is "they said something that cannot be compared",
 * and a value with `corrected` true is a person's reading standing over the extractor's.
 */
export const comparisonCellSchema = z.object({
  insurerId: uuidSchema,
  value: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  missing: z.boolean(),
  unclear: z.boolean(),
  corrected: z.boolean(),
  evidence: evidenceRefSchema.nullable(),
});
export type ComparisonCell = z.infer<typeof comparisonCellSchema>;

export const comparisonRowSchema = z.object({
  termType: QuoteTermType,
  label: z.string(),
  cells: z.array(comparisonCellSchema),
  /** True when at least one insurer did not state this at all. The row is not like-for-like. */
  incomplete: z.boolean(),
});
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;

export const comparisonColumnSchema = z.object({
  insurerId: uuidSchema,
  insurerName: z.string(),
  responseId: uuidSchema,
  receivedAt: z.string().nullable(),
  premiumAmount: z.string().nullable(),
  premiumCurrency: z.string().nullable(),
  validUntil: z.string().nullable(),
  /** True when the terms expire within a fortnight, or already have. Stated, never colour alone. */
  validityNote: z.string().max(200).nullable(),
  source: evidenceRefSchema.nullable(),
});
export type ComparisonColumn = z.infer<typeof comparisonColumnSchema>;

/**
 * What the comparison suggests, and why.
 *
 * `insurerId` is null whenever the quotes are not like-for-like or the cheapest is not plainly
 * the best — abstention is a state, not a blank (§36). Cheapest never wins by being cheapest:
 * the reasoning says what was weighed, and the caveats say what it could not weigh.
 */
export const comparisonRecommendationSchema = z.object({
  insurerId: uuidSchema.nullable(),
  insurerName: z.string().nullable(),
  headline: z.string().max(300),
  reasoning: z.array(z.string().max(300)),
  caveats: z.array(z.string().max(300)),
});
export type ComparisonRecommendation = z.infer<typeof comparisonRecommendationSchema>;

export const comparisonSchema = z.object({
  id: uuidSchema,
  generatedAt: z.string(),
  generatedByName: z.string().nullable(),
  presentedAt: z.string().nullable(),
  presentedByName: z.string().nullable(),
  /** True when a quote it included has changed since. The comparison is kept, never rewritten. */
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  changes: z.array(comparisonChangeSchema),
  columns: z.array(comparisonColumnSchema),
  rows: z.array(comparisonRowSchema),
  recommendation: comparisonRecommendationSchema,
});
export type Comparison = z.infer<typeof comparisonSchema>;

export const comparisonResponseSchema = z.object({
  opportunity: z.object({
    id: uuidSchema,
    title: z.string(),
    classOfBusiness: z.string(),
    coverStart: z.string().nullable(),
    coverEnd: z.string().nullable(),
    closedAt: z.string().nullable(),
  }),
  client: z.object({ id: uuidSchema, name: z.string() }),
  readiness: comparisonReadinessSchema,
  /** Null until one has been generated. A Space with no comparison says so and offers to make one. */
  comparison: comparisonSchema.nullable(),
  /** Earlier comparisons, kept for audit. Newest first, the live one excluded. */
  history: z.array(
    z.object({
      id: uuidSchema,
      generatedAt: z.string(),
      generatedByName: z.string().nullable(),
      presentedAt: z.string().nullable(),
      supersededAt: z.string().nullable(),
      supersededReason: z.string().nullable(),
    }),
  ),
  permissions: z.object({ canGenerate: z.boolean(), canPresent: z.boolean() }),
});
export type ComparisonResponse = z.infer<typeof comparisonResponseSchema>;

export const comparisonActionSchema = z.discriminatedUnion("action", [
  /** Takes the photograph. Supersedes the live one; the old is kept, not replaced. */
  z.object({ action: z.literal("generate_comparison") }),
  /** Records that this exact comparison went to the client. Refused while it is stale. */
  z.object({ action: z.literal("present_comparison"), comparisonId: uuidSchema }),
]);
export type ComparisonAction = z.infer<typeof comparisonActionSchema>;

export const comparisonActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(300).nullable().default(null),
  comparison: comparisonResponseSchema.nullable().default(null),
});
export type ComparisonActionResponse = z.infer<typeof comparisonActionResponseSchema>;
