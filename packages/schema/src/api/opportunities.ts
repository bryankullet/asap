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
  /* A quotation may offer a benefit as well as limit, exclude and condition one (0053). */
  "benefit",
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

/**
 * How long a quote still holds.
 *
 * Four states, never a silent blank: an insurer who did not say how long the terms stand has not
 * offered indefinite terms. `thresholdDays` and `thresholdSource` travel with the state because
 * "expiring soon" is a judgement, and a judgement with no stated basis is a number hidden in the
 * interface.
 */
export const ComparisonValidityState = z.enum(["valid", "expiring_soon", "expired", "not_stated"]);
export type ComparisonValidityState = z.infer<typeof ComparisonValidityState>;

export const comparisonValiditySchema = z.object({
  state: ComparisonValidityState,
  validUntil: z.string().nullable(),
  note: z.string().max(200),
  thresholdDays: z.number().int().min(0),
  /** Where the threshold came from: this brokerage's rule, or the product default, named. */
  thresholdSource: z.string().max(200),
});
export type ComparisonValidity = z.infer<typeof comparisonValiditySchema>;

export const comparisonColumnSchema = z.object({
  insurerId: uuidSchema,
  insurerName: z.string(),
  responseId: uuidSchema,
  receivedAt: z.string().nullable(),
  premiumAmount: z.string().nullable(),
  premiumCurrency: z.string().nullable(),
  validUntil: z.string().nullable(),
  validity: comparisonValiditySchema,
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
  /** Plain differences read off the rows. Stated whether or not a rule exists. */
  facts: z.array(z.string().max(300)),
  /** Why the rule reached this, when a rule applied, and why none did when none did. */
  reasoning: z.array(z.string().max(300)),
  caveats: z.array(z.string().max(300)),
  /** The brokerage's configured rule, with its provenance. Null when none is configured. */
  rule: z
    .object({
      summary: z.string().max(300),
      source: z.string().max(300),
      verifiedAt: z.string(),
    })
    .nullable(),
});
export type ComparisonRecommendation = z.infer<typeof comparisonRecommendationSchema>;

/** One value that has moved since the comparison was made: what it said, and what it says now. */
export const comparisonChangedValueSchema = z.object({
  insurerId: uuidSchema,
  insurerName: z.string(),
  termType: QuoteTermType.nullable(),
  label: z.string(),
  was: z.string().nullable(),
  now: z.string().nullable(),
});
export type ComparisonChangedValue = z.infer<typeof comparisonChangedValueSchema>;

export const comparisonSchema = z.object({
  id: uuidSchema,
  version: z.number().int().min(1),
  generatedAt: z.string(),
  generatedByName: z.string().nullable(),
  presentedAt: z.string().nullable(),
  presentedByName: z.string().nullable(),
  /** True when a quote it included has changed since. The comparison is kept, never rewritten. */
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  changes: z.array(comparisonChangeSchema),
  /** Old value → new value, for everything this comparison showed that has since moved. */
  changedValues: z.array(comparisonChangedValueSchema),
  columns: z.array(comparisonColumnSchema),
  rows: z.array(comparisonRowSchema),
  recommendation: comparisonRecommendationSchema,
  /**
   * Whether this exact comparison may be put in front of a client. False for a stale one, and
   * false while any quote in it has expired — an expired quotation is not an offer.
   */
  presentable: z.object({ can: z.boolean(), reason: z.string().max(300).nullable() }),
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
  /**
   * The comparison being read. The current one by default; an earlier version when one was asked
   * for by `?version=`, in which case it is shown exactly as it was made.
   */
  comparison: comparisonSchema.nullable(),
  /** True when `comparison` is an earlier version being read rather than the current one. */
  viewingHistory: z.boolean(),
  /** Earlier comparisons, kept for audit. Newest first, the live one excluded. */
  history: z.array(
    z.object({
      id: uuidSchema,
      version: z.number().int().min(1),
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

/* ---- The brokerage's own rules -----------------------------------------------------------------
 *
 * Kenyan legal and market values, and judgements like "when may ASAP name a recommended quote",
 * are per-brokerage with a source and a date. Never a constant in this codebase.
 */

/**
 * When ASAP may name a recommended quote.
 *
 * `abstain` is the default and what applies with no rule at all: state the differences, leave the
 * judgement to the broker. `cheapest_when_like_for_like` lets a brokerage say "name the cheaper
 * one, but only when the same cover is priced twice and the gap is at least this wide" — their
 * number, recorded with their reason for it.
 */
export const RecommendationMode = z.enum(["abstain", "cheapest_when_like_for_like"]);
export type RecommendationMode = z.infer<typeof RecommendationMode>;

export const recommendationRuleSchema = z.object({
  mode: RecommendationMode,
  /** Required by `cheapest_when_like_for_like`. Below this the quotes are treated as level. */
  minimumGapPercent: z.number().min(0).max(100).optional(),
});
export type RecommendationRule = z.infer<typeof recommendationRuleSchema>;

export const validityThresholdRuleSchema = z.object({
  expiringSoonDays: z.number().int().min(0).max(365),
});
export type ValidityThresholdRule = z.infer<typeof validityThresholdRuleSchema>;

/** Every key this deployment understands, and what a value for it must look like. */
export const COMPANY_RULE_KEYS = ["quote.recommendation", "quote.validity"] as const;
export const CompanyRuleKey = z.enum(COMPANY_RULE_KEYS);
export type CompanyRuleKey = z.infer<typeof CompanyRuleKey>;

export const companyRuleSchema = z.object({
  key: CompanyRuleKey,
  value: z.unknown(),
  source: z.string(),
  verifiedAt: z.string(),
  note: z.string().nullable(),
  setByName: z.string().nullable(),
  updatedAt: z.string(),
});
export type CompanyRuleView = z.infer<typeof companyRuleSchema>;

export const companyRulesResponseSchema = z.object({
  rules: z.array(companyRuleSchema),
  /** What applies where a brokerage has set nothing, said out loud rather than hidden. */
  defaults: z.array(
    z.object({ key: CompanyRuleKey, summary: z.string(), basis: z.string() }),
  ),
  permissions: z.object({ canEdit: z.boolean() }),
});
export type CompanyRulesResponse = z.infer<typeof companyRulesResponseSchema>;

export const setCompanyRuleRequestSchema = z.object({
  key: CompanyRuleKey,
  value: z.unknown(),
  source: z.string().trim().min(1).max(300),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});
export type SetCompanyRuleRequest = z.infer<typeof setCompanyRuleRequestSchema>;

/* ---- Reading a quotation ---------------------------------------------------------------------- */

export const ProposalState = z.enum(["proposed", "accepted", "corrected", "rejected"]);
export type ProposalState = z.infer<typeof ProposalState>;

export const ProposalCondition = z.enum(["known", "inferred", "conflicting", "unclear"]);
export type ProposalCondition = z.infer<typeof ProposalCondition>;

/** One thing the extractor thinks a quotation says. Never a confirmed term until a person says so. */
export const termProposalSchema = z.object({
  id: uuidSchema,
  ordinal: z.number().int().min(0),
  termType: QuoteTermType,
  label: z.string(),
  proposedValue: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  page: z.number().int().min(1).nullable(),
  region: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  condition: ProposalCondition,
  method: z.string(),
  state: ProposalState,
  correctedValue: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  quoteTermId: uuidSchema.nullable(),
});
export type TermProposal = z.infer<typeof termProposalSchema>;

export const quotationReadingResponseSchema = z.object({
  document: z.object({
    id: uuidSchema,
    filename: z.string(),
    pageCount: z.number().int().min(0).nullable(),
    extractionState: z.string(),
  }),
  /**
   * Set when the document cannot be read at all. An image-only quotation says so rather than
   * coming back as a quotation that states nothing — there is no OCR in this deployment.
   */
  needsManualReview: z.string().max(400).nullable(),
  /** Which insurer's answer this reading belongs to. Chosen by a person, never by name likeness. */
  linkedTo: z
    .object({ insurerResponseId: uuidSchema, insurerName: z.string(), opportunityId: uuidSchema })
    .nullable(),
  /** Header values, one per key, from the existing document-field review path. */
  fields: z.array(
    z.object({
      fieldKey: z.string(),
      proposedValue: z.string().nullable(),
      correctedValue: z.string().nullable(),
      page: z.number().int().min(1).nullable(),
      condition: z.string(),
      state: z.string(),
    }),
  ),
  /** Repeated terms, one row each. Never flattened. */
  proposals: z.array(termProposalSchema),
  permissions: z.object({ canReview: z.boolean() }),
});
export type QuotationReadingResponse = z.infer<typeof quotationReadingResponseSchema>;

export const quotationReviewActionSchema = z.discriminatedUnion("action", [
  /** Read the document again. Idempotent: a re-read updates its own proposals, never duplicates. */
  z.object({ action: z.literal("read_document"), documentId: uuidSchema }),
  /** A person choosing which answer this quotation belongs to. ASAP never guesses it. */
  z.object({
    action: z.literal("link_to_response"),
    documentId: uuidSchema,
    insurerResponseId: uuidSchema,
  }),
  z.object({ action: z.literal("accept_proposal"), proposalId: uuidSchema }),
  z.object({
    action: z.literal("correct_proposal"),
    proposalId: uuidSchema,
    correctedValue: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("reject_proposal"), proposalId: uuidSchema }),
]);
export type QuotationReviewAction = z.infer<typeof quotationReviewActionSchema>;

export const quotationReviewResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(400).nullable().default(null),
  reading: quotationReadingResponseSchema.nullable().default(null),
});
export type QuotationReviewResponse = z.infer<typeof quotationReviewResponseSchema>;
