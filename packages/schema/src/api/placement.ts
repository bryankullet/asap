import { z } from "zod";
import { uuidSchema } from "./common.js";
import { CoverStatus } from "../status.js";
import { evidenceRefSchema, QuoteTermType } from "./opportunities.js";

/**
 * Placement (4B-4).
 *
 * Nothing here carries a stored status. Where a placement has got to is read from which facts
 * exist — an instruction, a request, an approval, a submission, a confirmation — so the words on
 * screen cannot run ahead of the evidence (D-027).
 *
 * Three vocabularies meet on this screen and must not borrow from one another:
 *
 *   - the **work** a person owns: Yours · With Jubilee since 12 Aug · In progress · Done;
 *   - the **cover**: Requested · Submitted · Confirmed · Active cover · Expired · Cancelled;
 *   - the **run** of any job, which lives only in Activity and never appears here.
 */

/**
 * The cover-period line uses the one cover vocabulary in the codebase — `CoverStatus` and its
 * labels in `status.ts` — and no other. A second enum here would be a second place the word
 * "Confirmed" could mean something, which is exactly what that file exists to prevent.
 *
 *   requested    — a request is prepared and awaits an authorised submission;
 *   submitted    — there is proof it reached the insurer;
 *   confirmed    — the insurer confirmed cover, with evidence, and it has not begun;
 *   active       — shown as "Active cover": confirmed, begun, neither expired nor cancelled;
 *   expired      — confirmed cover whose end has passed;
 *   cancelled    — evidence of cancellation exists.
 *
 * `draft` is not used here. A placement with nothing requested has no cover line at all.
 */
export const PlacementCoverStatus = CoverStatus.exclude(["draft"]);
export type PlacementCoverStatus = z.infer<typeof PlacementCoverStatus>;

export const InstructionSource = z.enum([
  "email",
  "document",
  "telephone",
  "meeting",
  "signed_acceptance",
  "in_person",
]);
export type InstructionSource = z.infer<typeof InstructionSource>;

export const SubmissionMethod = z.enum([
  "provider_email",
  "recorded_manual_email",
  "recorded_portal",
  "recorded_post",
  "recorded_in_person",
]);
export type SubmissionMethod = z.infer<typeof SubmissionMethod>;

export const PlacementInsurerOutcome = z.enum([
  "confirmed_as_requested",
  "confirmed_with_changes",
  "more_information_required",
  "declined",
]);
export type PlacementInsurerOutcome = z.infer<typeof PlacementInsurerOutcome>;

export const clientInstructionSchema = z.object({
  id: uuidSchema,
  source: InstructionSource,
  evidence: evidenceRefSchema,
  clientConditions: z.string().nullable(),
  instructedAt: z.string(),
  recordedByName: z.string().nullable(),
  recordedAt: z.string(),
  /** The exact comparison version the client was shown. Null only for a recorded exception. */
  comparisonVersion: z.number().int().min(1).nullable(),
  outsideComparison: z.boolean(),
  exceptionReason: z.string().nullable(),
  supersededAt: z.string().nullable(),
  supersededReason: z.string().nullable(),
});
export type ClientInstructionView = z.infer<typeof clientInstructionSchema>;

/** What the client accepted, frozen. Never read from the live quotation. */
export const placementBasisSchema = z.object({
  premiumAmount: z.string().nullable(),
  premiumCurrency: z.string().nullable(),
  validUntil: z.string().nullable(),
  terms: z.array(
    z.object({
      termType: QuoteTermType,
      label: z.string(),
      value: z.string().nullable(),
      amount: z.string().nullable(),
      currency: z.string().nullable(),
      unclear: z.boolean(),
    }),
  ),
});
export type PlacementBasis = z.infer<typeof placementBasisSchema>;

/**
 * Whether the quotation has moved since the client accepted it. When it has, nothing may be
 * sent until a person reviews the change — and where it is material, the client instructs again.
 */
export const placementDriftSchema = z.object({
  stale: z.boolean(),
  changes: z.array(z.object({ label: z.string(), was: z.string().nullable(), now: z.string().nullable() })),
});
export type PlacementDrift = z.infer<typeof placementDriftSchema>;

export const placementRequestSchema = z.object({
  id: uuidSchema,
  version: z.number().int().min(1),
  subject: z.string(),
  body: z.string(),
  coverRequested: z.string(),
  effectiveAt: z.string(),
  outstandingConditions: z.string().nullable(),
  sha256: z.string(),
  preparedByName: z.string().nullable(),
  preparedAt: z.string(),
  approval: z.object({ approvedByName: z.string().nullable(), approvedAt: z.string() }).nullable(),
  /** Proof it left the brokerage. Null means it has not — whatever else is true. */
  submission: z
    .object({
      method: SubmissionMethod,
      recipient: z.string(),
      sentAt: z.string(),
      evidence: evidenceRefSchema,
      recordedByName: z.string().nullable(),
    })
    .nullable(),
});
export type PlacementRequestView = z.infer<typeof placementRequestSchema>;

export const placementInsurerResponseSchema = z.object({
  outcome: PlacementInsurerOutcome,
  receivedAt: z.string(),
  effectiveAt: z.string().nullable(),
  expiryAt: z.string().nullable(),
  insurerReference: z.string().nullable(),
  changesNote: z.string().nullable(),
  informationRequired: z.string().nullable(),
  declineReason: z.string().nullable(),
  evidence: evidenceRefSchema,
  recordedByName: z.string().nullable(),
});
export type PlacementInsurerResponseView = z.infer<typeof placementInsurerResponseSchema>;

export const placementResponseSchema = z.object({
  placement: z.object({
    id: uuidSchema,
    title: z.string(),
    requestedEffectiveAt: z.string(),
    requestedExpiryAt: z.string().nullable(),
    createdAt: z.string(),
  }),
  client: z.object({ id: uuidSchema, name: z.string() }),
  opportunity: z.object({ id: uuidSchema, title: z.string(), classOfBusiness: z.string() }),
  insurer: z.object({ id: uuidSchema, name: z.string() }),
  workItem: z.object({
    id: uuidSchema,
    taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
    taskParty: z.string().nullable(),
    taskSince: z.string().nullable(),
  }),
  instruction: clientInstructionSchema,
  instructionHistory: z.array(clientInstructionSchema),
  basis: placementBasisSchema,
  drift: placementDriftSchema,
  request: placementRequestSchema.nullable(),
  requestHistory: z.array(
    z.object({
      version: z.number().int().min(1),
      preparedAt: z.string(),
      approvedAt: z.string().nullable(),
      supersededAt: z.string().nullable(),
      supersededReason: z.string().nullable(),
    }),
  ),
  insurerResponse: placementInsurerResponseSchema.nullable(),
  cancellation: z
    .object({ cancelledAt: z.string(), reason: z.string(), evidence: evidenceRefSchema })
    .nullable(),
  /** The cover-period line. Null while nothing has been requested. */
  cover: z.object({
    state: PlacementCoverStatus.nullable(),
    line: z.string().max(300),
  }),
  /** What stops the next step, each a sentence a person can act on. Never a bare "Waiting". */
  blockers: z.array(z.string().max(300)),
  nextAction: z.string().max(300),
  permissions: z.object({
    canRecordInstruction: z.boolean(),
    canPrepare: z.boolean(),
    canApprove: z.boolean(),
    canRecordSubmission: z.boolean(),
    canRecordResponse: z.boolean(),
    /** Who may approve, read from this brokerage's roles. Said to a person who cannot. */
    approverRoles: z.array(z.string()),
  }),
  sending: z.object({ available: z.boolean(), reason: z.string().max(300).nullable() }),
  /** Whether policy issuance may be prepared — only once cover is confirmed. */
  issuance: z.object({
    ready: z.boolean(),
    reason: z.string().max(300).nullable(),
    workItemId: uuidSchema.nullable(),
  }),
});
export type PlacementResponse = z.infer<typeof placementResponseSchema>;

/* ---- What a person may do ------------------------------------------------------------------ */

/**
 * The client's instruction. Recorded against the quotation work, because it is what creates the
 * placement. A broker's click is not evidence: the source and the evidence are required.
 */
export const recordInstructionRequestSchema = z.object({
  insurerResponseId: uuidSchema,
  source: InstructionSource,
  evidenceEmailMessageId: uuidSchema.optional(),
  evidenceDocumentId: uuidSchema.optional(),
  evidenceNote: z.string().trim().max(1000).optional(),
  clientConditions: z.string().trim().max(2000).optional(),
  instructedAt: z.string().datetime({ offset: true }),
  requestedEffectiveAt: z.string().datetime({ offset: true }),
  requestedExpiryAt: z.string().datetime({ offset: true }).optional(),
  /** Only with the permission to approve, a reason and evidence. Never the ordinary route. */
  outsideComparison: z
    .object({ reason: z.string().trim().min(10).max(1000) })
    .optional(),
});
export type RecordInstructionRequest = z.infer<typeof recordInstructionRequestSchema>;

export const recordInstructionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(400).nullable().default(null),
  placementId: uuidSchema.nullable().default(null),
});
export type RecordInstructionResponse = z.infer<typeof recordInstructionResponseSchema>;

export const placementActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare_request"),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
    coverRequested: z.string().trim().min(1).max(1000),
    outstandingConditions: z.string().trim().max(2000).optional(),
  }),
  z.object({ action: z.literal("approve_request"), placementRequestId: uuidSchema }),
  z.object({
    action: z.literal("record_submission"),
    placementRequestId: uuidSchema,
    method: SubmissionMethod.exclude(["provider_email"]),
    recipient: z.string().trim().min(3).max(300),
    sentAt: z.string().datetime({ offset: true }),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
    /** The same intent retried carries the same key, so a double click records one submission. */
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    action: z.literal("record_insurer_response"),
    outcome: PlacementInsurerOutcome,
    receivedAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
    expiryAt: z.string().datetime({ offset: true }).optional(),
    insurerReference: z.string().trim().max(200).optional(),
    changesNote: z.string().trim().max(2000).optional(),
    informationRequired: z.string().trim().max(2000).optional(),
    declineReason: z.string().trim().max(1000).optional(),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceEmailMessageId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("record_cancellation"),
    cancelledAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(5).max(1000),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceEmailMessageId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
  }),
  /** Opens the 4B-5 handoff as Work. Refused until cover is confirmed. Creates no policy. */
  z.object({ action: z.literal("prepare_issuance") }),
]);
export type PlacementAction = z.infer<typeof placementActionSchema>;

export const placementActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(400).nullable().default(null),
  placement: placementResponseSchema.nullable().default(null),
});
export type PlacementActionResponse = z.infer<typeof placementActionResponseSchema>;
