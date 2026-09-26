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
  /** Version 1 is the instruction; a later version exists only where the client accepted changes. */
  version: z.number().int().min(1),
  origin: z.enum(["instruction", "client_accepted_changes"]),
  classOfBusiness: z.string().nullable(),
  subject: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  expiryAt: z.string().nullable(),
  premiumBasis: z.string().nullable(),
  clientConditions: z.string().nullable(),
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

export const confirmationTermSchema = z.object({
  termType: QuoteTermType,
  label: z.string(),
  value: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  unclear: z.boolean(),
});

export const placementInsurerResponseSchema = z.object({
  id: uuidSchema,
  outcome: PlacementInsurerOutcome,
  confirmedPremiumAmount: z.string().nullable(),
  confirmedPremiumCurrency: z.string().nullable(),
  confirmedPremiumBasis: z.string().nullable(),
  confirmedSubject: z.string().nullable(),
  confirmedClassOfBusiness: z.string().nullable(),
  terms: z.array(confirmationTermSchema),
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

export const MatchClass = z.enum([
  "match",
  "changed",
  "missing_from_confirmation",
  "added_by_insurer",
  "unclear",
  "not_applicable",
]);
export type MatchClass = z.infer<typeof MatchClass>;

/**
 * The insurer's confirmation against what the client accepted, field by field. `current` is
 * false when either input has moved since — a newer accepted basis, or a newer insurer answer —
 * and a stale check says nothing about the cover as it stands.
 */
export const coverMatchSchema = z.object({
  id: uuidSchema,
  comparedAt: z.string(),
  comparedByName: z.string().nullable(),
  basisVersion: z.number().int().min(1),
  current: z.boolean(),
  staleReason: z.string().nullable(),
  materialDifferences: z.number().int().min(0),
  unclearCount: z.number().int().min(0),
  items: z.array(
    z.object({
      id: uuidSchema,
      field: z.string(),
      termType: z.string().nullable(),
      label: z.string(),
      acceptedValue: z.string().nullable(),
      confirmedValue: z.string().nullable(),
      classification: MatchClass,
      material: z.boolean(),
    }),
  ),
});
export type CoverMatchView = z.infer<typeof coverMatchSchema>;

export const ChangeDecision = z.enum(["accept_all", "reject", "partial"]);
export type ChangeDecision = z.infer<typeof ChangeDecision>;

export const changeAcceptanceSchema = z.object({
  decision: ChangeDecision,
  decidedAt: z.string(),
  source: InstructionSource,
  evidence: evidenceRefSchema,
  recordedByName: z.string().nullable(),
  items: z.array(z.object({ label: z.string(), decision: z.enum(["accepted", "rejected", "clarify"]) })),
  /**
   * What to send next, as a draft. Never sent, and never said to have been: sending from ASAP is
   * not connected, so a person copies it into the mailbox it should go from.
   */
  followUpDraft: z.string().nullable(),
});
export type ChangeAcceptanceView = z.infer<typeof changeAcceptanceSchema>;

/**
 * Whether policy issuance may begin. `blocked` always carries its reasons; nothing here is a
 * "not yet" without saying what is missing.
 */
export const issuanceReadinessSchema = z.object({
  state: z.enum(["ready", "blocked"]),
  reasons: z.array(z.object({ code: z.string(), message: z.string().max(400) })),
  /** Recorded, not enforced: payment before issuance becomes a company rule when Money exists. */
  deferredChecks: z.array(z.string().max(300)),
  workItemId: uuidSchema.nullable(),
});
export type IssuanceReadiness = z.infer<typeof issuanceReadinessSchema>;

/** One placement Work item, with everything a broker needs to act on it without Activity. */
export const placementWorkSchema = z.object({
  id: uuidSchema,
  reason: z.string(),
  /** The part after the task-status label: "approve placement request". */
  headline: z.string(),
  why: z.string(),
  action: z.string(),
  evidence: z.string(),
  after: z.string(),
  taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
  taskParty: z.string().nullable(),
  taskSince: z.string().nullable(),
  taskNextCheck: z.string().nullable(),
  ownerName: z.string().nullable(),
});
export type PlacementWork = z.infer<typeof placementWorkSchema>;

export const PreparedActionType = z.enum([
  "record_instruction",
  "prepare_request",
  "request_approval",
  "approve_request",
  "record_submission",
  "record_insurer_response",
  "record_client_acceptance",
  "prepare_issuance",
]);
export type PreparedActionType = z.infer<typeof PreparedActionType>;

/**
 * What Ask prepared, held on the server. It executes only when a person confirms it, and only if
 * nothing it was built from has moved since.
 */
export const preparedActionSchema = z.object({
  id: uuidSchema,
  actionType: PreparedActionType,
  placementId: uuidSchema.nullable(),
  opportunityId: uuidSchema.nullable(),
  summary: z.string().max(300),
  changes: z.array(z.string().max(400)),
  blockers: z.array(z.string().max(400)),
  permitted: z.boolean(),
  requiresConfirmation: z.boolean(),
  state: z.enum(["prepared", "executed", "stale", "refused", "discarded", "expired"]),
  preparedAt: z.string(),
  expiresAt: z.string(),
  preparedByName: z.string().nullable(),
  receipt: z
    .object({ message: z.string(), at: z.string(), by: z.string().nullable() })
    .nullable(),
});
export type PreparedActionView = z.infer<typeof preparedActionSchema>;

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
  /** Every open Work item for this placement, with its reason. One lifecycle reason at a time. */
  work: z.array(placementWorkSchema),
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
  coverMatch: coverMatchSchema.nullable(),
  changeAcceptance: changeAcceptanceSchema.nullable(),
  readiness: issuanceReadinessSchema,
  preparedActions: z.array(preparedActionSchema),
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
  /** Put the approval in front of a named person. Assigns the Work; approves nothing. */
  z.object({ action: z.literal("request_approval"), approverUserId: uuidSchema }),
  z.object({
    action: z.literal("record_insurer_response"),
    outcome: PlacementInsurerOutcome,
    confirmedPremiumAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    confirmedPremiumCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    confirmedPremiumBasis: z.string().trim().max(300).optional(),
    confirmedSubject: z.string().trim().max(500).optional(),
    confirmedClassOfBusiness: z.string().trim().max(100).optional(),
    /**
     * Where the insurer's terms differ from what was requested: each changed, added or removed
     * term. Omitted terms are confirmed as requested. `value: null` means the insurer dropped it.
     */
    termChanges: z
      .array(
        z.object({
          termType: QuoteTermType,
          label: z.string().trim().min(1).max(200),
          value: z.string().trim().max(500).nullable(),
          unclear: z.boolean().optional(),
        }),
      )
      .max(50)
      .optional(),
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
  /** Re-run the cover check against the current accepted basis and insurer answer. */
  z.object({ action: z.literal("verify_cover_match") }),
  /**
   * The client's answer to the insurer's changes. Partial acceptance is never treated as full:
   * each item the client queried is recorded as such, and what was agreed does not change.
   */
  z.object({
    action: z.literal("record_client_acceptance"),
    coverMatchId: uuidSchema,
    decision: ChangeDecision,
    source: InstructionSource,
    decidedAt: z.string().datetime({ offset: true }),
    evidenceEmailMessageId: uuidSchema.optional(),
    evidenceDocumentId: uuidSchema.optional(),
    evidenceNote: z.string().trim().max(1000).optional(),
    items: z
      .array(z.object({ coverMatchItemId: uuidSchema, decision: z.enum(["accepted", "rejected", "clarify"]) }))
      .max(100)
      .optional(),
  }),
  /** Opens the 4B-5 handoff as Work. Refused unless readiness is `ready`. Creates no policy. */
  z.object({ action: z.literal("prepare_issuance") }),
]);
export type PlacementAction = z.infer<typeof placementActionSchema>;

export const placementActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().max(400).nullable().default(null),
  placement: placementResponseSchema.nullable().default(null),
});
export type PlacementActionResponse = z.infer<typeof placementActionResponseSchema>;


/* ---- Preparing an action for a person to confirm --------------------------------------------- */

/**
 * What Ask (or a screen) asks the server to prepare. Names may stand in for ids where a person
 * spoke them — "Jubilee", "Mary" — and the server resolves them against this placement's own
 * records only, exactly, never by resemblance. A missing fact comes back as one question.
 */
export const prepareActionRequestSchema = z.object({
  actionType: PreparedActionType,
  placementId: uuidSchema.optional(),
  opportunityId: uuidSchema.optional(),
  insurerName: z.string().trim().max(200).optional(),
  approverName: z.string().trim().max(200).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type PrepareActionRequest = z.infer<typeof prepareActionRequestSchema>;

export const prepareActionResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("prepared"), action: preparedActionSchema }),
  z.object({
    state: z.literal("clarify"),
    question: z.string().max(400),
    missing: z.array(z.string().max(100)),
    options: z.array(z.object({ label: z.string().max(200), value: z.string().max(200) })).max(20),
  }),
  z.object({ state: z.literal("refused"), reason: z.string().max(400) }),
]);
export type PrepareActionResponse = z.infer<typeof prepareActionResponseSchema>;

export const confirmPreparedActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "refused"]),
  reason: z.string().max(400).nullable().default(null),
  action: preparedActionSchema.nullable().default(null),
});
export type ConfirmPreparedActionResponse = z.infer<typeof confirmPreparedActionResponseSchema>;
