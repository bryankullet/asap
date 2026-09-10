import { z } from "zod";

/**
 * The generative UI contract — UI Build Spec v1, Part 4.1.
 *
 * `ComponentId` is the full component library: the v1 catalogue's "Shared reusable components"
 * table, plus `RelationshipSummary` from Architecture §18, plus the twelve components for the
 * Screen Map v3 surfaces (X08, K01–K03, G01–G02, T01–T02, N01–N04). `AskComponentId` is the
 * strict subset the model may return: shell, shared-state, run and the twelve v3 components are
 * excluded, because Ask opens and prepares things and never renders an approval, a settlement or
 * a compliance decision by itself. Validation step 2 (Part 4.2) checks against `AskComponentId`.
 * Decided by the operator on 2026-09-08 (D-041).
 */
const SHELL = [
  "AppShell",
  "AskComposer",
  "ContextChip",
  "SpaceHeader",
  "RelatedSpaceLink",
  "ActionMenu",
] as const;
const CLIENT_POLICY = [
  "ClientHeader",
  "ContactCard",
  "RelationshipSummary",
  "PolicyCard",
  "CoverageTable",
  "PolicyTimeline",
  "PolicySchedule",
  "ExpiryIndicator",
  "ClaimPartyCard",
] as const;
const QUOTE_RENEWAL = [
  "QuoteCard",
  "QuoteComparison",
  "CoverageComparison",
  "InsurerResponseTracker",
  "RenewalReadiness",
  "RenewalTimeline",
  "TermComparison",
] as const;
const CLAIMS_SERVICE = [
  "ClaimStatus",
  "ClaimTimeline",
  "MissingDocuments",
  "ServiceProgress",
  "BeforeAfterChange",
  "EffectiveDateReview",
] as const;
const DOCUMENTS_EMAIL = [
  "DocumentCard",
  "DocumentViewer",
  "DocumentChecklist",
  "ExtractionReview",
  "EmailThread",
  "DraftEmail",
  "CommunicationSummary",
] as const;
const MONEY_EFFORT = [
  "OutstandingPremiumCard",
  "InvoiceTable",
  "PaymentTimeline",
  "CommissionReconciliation",
  "AllocationEditor",
  "TaxEvidenceCard",
  "EffortEntry",
] as const;
const HUMAN_WORK = [
  "WorkCard",
  "WaitingCard",
  "ExceptionCard",
  "ApprovalCard",
  "AssignmentCard",
  "CompletionChecklist",
] as const;
const ANALYSIS = [
  "RecommendationCard",
  "Metric",
  "Table",
  "Chart",
  "Timeline",
  "Checklist",
  "Alert",
  "ActivityFeed",
  "SourceEvidence",
] as const;
const AI_RULES = [
  "JobProgress",
  "StepOutcome",
  "TriggerConditionEditor",
  "ApprovalRule",
  "TestResult",
  "AutomationRunHistory",
] as const;
const SHARED_STATES = [
  "EmptyState",
  "LoadingStep",
  "MissingData",
  "ConflictReview",
  "PartialSuccess",
  "StaleData",
  "PermissionNotice",
  "ErrorRecovery",
] as const;
/** Screen Map v3 surfaces: X08, K01–K03, G01–G02, T01–T02, N01–N04. */
const V3_SURFACES = [
  "PremiumBreakdown",
  "ClientFileStatus",
  "DueDiligenceChecklist",
  "ScreeningMatchReview",
  "AgreementCard",
  "RateTable",
  "CertificateStockTable",
  "CertificateCard",
  "UnidentifiedReceiptsTable",
  "InsurerAccountSummary",
  "SettlementRunTable",
  "TaxCertificateTable",
] as const;

export const ComponentId = z.enum([
  ...SHELL,
  ...CLIENT_POLICY,
  ...QUOTE_RENEWAL,
  ...CLAIMS_SERVICE,
  ...DOCUMENTS_EMAIL,
  ...MONEY_EFFORT,
  ...HUMAN_WORK,
  ...ANALYSIS,
  ...AI_RULES,
  ...SHARED_STATES,
  ...V3_SURFACES,
]);
export type ComponentId = z.infer<typeof ComponentId>;

/** What the model may return. Everything else is the shell's or a person's to render. */
export const AskComponentId = z.enum([
  ...CLIENT_POLICY,
  ...QUOTE_RENEWAL,
  ...CLAIMS_SERVICE,
  ...DOCUMENTS_EMAIL,
  ...MONEY_EFFORT,
  ...HUMAN_WORK,
  ...ANALYSIS,
]);
export type AskComponentId = z.infer<typeof AskComponentId>;

export const UiIntentType = z.enum([
  "answer",
  "open_record",
  "work_list",
  "draft",
  "automation",
  "panel",
]);
/**
 * Which blocks a question asks for. `policy` was added with the first Renewal Space (D-059): the
 * prototype's routing answers "show me the current policy" by changing the blocks while keeping
 * the client's context, and there was no view for it. Additive; every other value is unchanged.
 */
export const UiIntentView = z.enum([
  "summary",
  "blocker",
  "comparison",
  "policy",
  "money",
  "documents",
  "timeline",
]);

export const UiIntent = z.strictObject({
  type: UiIntentType,
  /** Must resolve to a record the caller can read, checked server-side under RLS (Part 4.2 step 3). */
  target: z.string().nullable(),
  /** Must exist in the registry at the requested version (Part 4.2 step 2). */
  panel: AskComponentId.nullable(),
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
