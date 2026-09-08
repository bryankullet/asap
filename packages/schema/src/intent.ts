import { z } from "zod";

/**
 * The generative UI contract — UI Build Spec v1, Part 4.1.
 *
 * Ask returns an intent, never markup. The JSON Schema generated here is what the model is
 * constrained to; the seven-step validation pipeline (Part 4.2) runs server-side on top of it.
 *
 * `ComponentId` is the component registry as named by Architecture v3.1 §18. Whether that
 * registry collapses into this narrower intent is open (spec Part 13, item 6); until decided, the
 * registry list is the source and this enum mirrors it.
 */
export const ComponentId = z.enum([
  // Client
  "ClientHeader",
  "ContactCard",
  "RelationshipSummary",
  // Policy
  "PolicyCard",
  "CoverageTable",
  "PolicyTimeline",
  "PolicySchedule",
  "ExpiryIndicator",
  // Quote
  "QuoteCard",
  "QuoteComparison",
  "CoverageComparison",
  "InsurerResponseTracker",
  // Renewal
  "RenewalReadiness",
  "RenewalTimeline",
  "TermComparison",
  // Claim
  "ClaimStatus",
  "ClaimTimeline",
  "MissingDocuments",
  "ClaimPartyCard",
  // Document
  "DocumentCard",
  "DocumentViewer",
  "DocumentChecklist",
  "ExtractionReview",
  // Email
  "EmailThread",
  "DraftEmail",
  "CommunicationSummary",
  // Money
  "OutstandingPremiumCard",
  "InvoiceTable",
  "PaymentTimeline",
  "CommissionReconciliation",
  // Work
  "WorkCard",
  "WaitingCard",
  "ExceptionCard",
  "ApprovalCard",
  "AssignmentCard",
  // Generic
  "RecommendationCard",
  "Metric",
  "Table",
  "Chart",
  "Timeline",
  "Checklist",
  "Alert",
  "ActivityFeed",
  "SourceEvidence",
]);
export type ComponentId = z.infer<typeof ComponentId>;

export const UiIntentType = z.enum([
  "answer",
  "open_record",
  "work_list",
  "draft",
  "automation",
  "panel",
]);
export const UiIntentView = z.enum([
  "summary",
  "blocker",
  "comparison",
  "money",
  "documents",
  "timeline",
]);

export const UiIntent = z.strictObject({
  type: UiIntentType,
  /** Must resolve to a record the caller can read, checked server-side under RLS (Part 4.2 step 3). */
  target: z.string().nullable(),
  /** Must exist in the registry at the requested version (Part 4.2 step 2). */
  panel: ComponentId.nullable(),
  view: UiIntentView,
  answer: z.string(),
  suggestions: z.array(z.string()).max(4),
});
export type UiIntent = z.infer<typeof UiIntent>;

/**
 * Strict JSON Schema for the model. Generated from the Zod type with Zod 4's native
 * `z.toJSONSchema` (the successor to the separate zod-to-json-schema package for Zod 4);
 * `intent.test.ts` proves `additionalProperties: false` at every object level.
 */
export const uiIntentJsonSchema = z.toJSONSchema(UiIntent, { target: "draft-2020-12" });
