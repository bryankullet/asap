import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * The Policy Space (4C-1): one real policy and its periods, assembled by the server.
 *
 * Three rules shape this contract:
 *
 *  - **Cover state is the server's.** `cover` carries the state and the reason and evidence behind
 *    it. The browser never re-derives "Active cover" from dates. A period with no cover evidence
 *    has no cover state at all — it says cover has not been verified.
 *  - **Every value carries its source.** Confirmed, extracted and accepted, corrected by a person,
 *    manually recorded, missing, conflicting, or unverified — with the document, page, region and
 *    who reviewed it where evidence exists. A value is never borrowed from another period.
 *  - **Money is not here.** A premium is shown as a recorded fact. Whether it was invoiced, paid,
 *    received or reconciled is Money (4D), and nothing in this contract can say so.
 */

/** The only cover words. A period with no verified evidence has none of them. */
export const PolicyCoverState = z.enum(["requested", "submitted", "confirmed", "active", "expired", "cancelled"]);
export type PolicyCoverState = z.infer<typeof PolicyCoverState>;

export const ValueSource = z.enum(["confirmed", "extracted_accepted", "corrected", "manually_recorded", "missing", "conflicting", "unverified"]);
export type ValueSource = z.infer<typeof ValueSource>;

export const policyEvidenceSchema = z.object({
  kind: z.enum(["cover_confirmation", "issued_document", "document", "issuance_application", "cancellation", "note"]),
  label: z.string().max(400),
  documentId: uuidSchema.nullable(),
  page: z.number().int().min(1).nullable(),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
  /** Where it opens: the document at its page with the value highlighted, or the record it came from. */
  path: z.string().max(400).nullable(),
  recordedByName: z.string().nullable(),
  recordedAt: z.string().nullable(),
});
export type PolicyEvidence = z.infer<typeof policyEvidenceSchema>;

export const policyCoverSchema = z.object({
  state: PolicyCoverState.nullable(),
  /** "Active cover", "Cover not verified", "Two periods both cover today" — never a bare date range. */
  label: z.string().max(120),
  reason: z.string().max(600),
  verified: z.boolean(),
  evidence: z.array(policyEvidenceSchema).max(10),
  /** The Nairobi calendar day the state was derived for. */
  asOf: z.string(),
});
export type PolicyCover = z.infer<typeof policyCoverSchema>;

export const policyPeriodViewSchema = z.object({
  id: uuidSchema,
  start: z.string(),
  end: z.string(),
  cover: policyCoverSchema,
  /** How this period entered the book: from an issued policy, from a reviewed document, or by hand. */
  origin: z.enum(["issuance", "document", "manual"]),
  when: z.enum(["current", "future", "past"]),
  overlapsWith: z.array(uuidSchema),
  premium: z.object({ amount: z.string().nullable(), currency: z.string().nullable(), basis: z.enum(["gross", "total_payable"]).nullable(), source: ValueSource }),
  createdAt: z.string(),
});
export type PolicyPeriodView = z.infer<typeof policyPeriodViewSchema>;

export const policyFactSchema = z.object({
  key: z.string().max(60),
  label: z.string().max(120),
  value: z.string().max(400).nullable(),
  source: ValueSource,
  evidence: policyEvidenceSchema.nullable(),
  note: z.string().max(400).nullable(),
});
export type PolicyFact = z.infer<typeof policyFactSchema>;

/** One term seen four ways: agreed at placement, confirmed by the insurer, printed, and final. */
export const policyTermSchema = z.object({
  termType: z.string().max(40),
  label: z.string().max(200),
  agreed: z.string().max(400).nullable(),
  confirmed: z.string().max(400).nullable(),
  issued: z.string().max(400).nullable(),
  final: z.string().max(400).nullable(),
  source: ValueSource,
  evidence: policyEvidenceSchema.nullable(),
  /** The issued-policy check's words, and how a difference was resolved, when it differed. */
  difference: z.object({ words: z.string(), resolved: z.boolean(), resolution: z.string().nullable() }).nullable(),
});
export type PolicyTerm = z.infer<typeof policyTermSchema>;

export const policyTimelineEventSchema = z.object({
  id: z.string().max(120),
  at: z.string(),
  text: z.string().max(400),
  tone: z.enum(["neutral", "active", "done", "attention", "waiting"]),
  path: z.string().max(400).nullable(),
});

export const policyWorkSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  kind: z.string(),
  taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
  taskParty: z.string().nullable(),
  taskSince: z.string().nullable(),
  reason: z.string().nullable(),
  requiredAction: z.string().nullable(),
  evidenceNeeded: z.string().nullable(),
  outcomeAfter: z.string().nullable(),
  path: z.string(),
});
export type PolicyWork = z.infer<typeof policyWorkSchema>;

export const PolicyActionKey = z.enum([
  "start_renewal", "report_claim", "request_endorsement", "open_servicing", "review_documents",
  "open_client", "open_placement", "open_issuance",
]);
export type PolicyActionKey = z.infer<typeof PolicyActionKey>;

export const policyActionSchema = z.object({
  key: PolicyActionKey,
  label: z.string().max(80),
  available: z.boolean(),
  /** Why it is disabled — a missing permission or a workflow that is not built yet. */
  reason: z.string().max(300).nullable(),
  /** Where it goes: a form with the client and policy preselected, or a Space. Null for a server action. */
  path: z.string().max(400).nullable(),
});
export type PolicyAction = z.infer<typeof policyActionSchema>;

export const policyRelatedSchema = z.object({
  kind: z.enum(["client", "placement", "issuance", "quotation", "comparison", "document", "claim", "endorsement", "renewal"]),
  id: uuidSchema,
  title: z.string().max(300),
  path: z.string().max(400),
});

export const policySpaceResponseSchema = z.object({
  policy: z.object({ id: uuidSchema, classOfBusiness: z.string(), createdAt: z.string() }),
  title: z.string(),
  client: z.object({ id: uuidSchema, name: z.string() }),
  insurer: z.object({ id: uuidSchema, name: z.string() }),
  /** Every period, oldest first. None is ever dropped because a later one exists. */
  periods: z.array(policyPeriodViewSchema),
  /** The period this reading is about. Null when periods conflict and none was asked for. */
  selectedPeriodId: uuidSchema.nullable(),
  selection: z.enum(["requested", "current", "upcoming", "latest", "none"]),
  /** Where the policy stands as a whole today. */
  cover: policyCoverSchema,
  conflicts: z.array(z.object({ kind: z.literal("overlapping_periods"), periodIds: z.array(uuidSchema), message: z.string() })),
  facts: z.array(policyFactSchema),
  terms: z.array(policyTermSchema),
  clientConditions: z.array(z.object({ text: z.string(), state: z.string(), evidence: z.string().nullable() })),
  /** Placement-agreed, insurer-confirmed and issued values that differed, with how each was settled. */
  differences: z.array(z.object({ label: z.string(), words: z.string(), agreed: z.string().nullable(), confirmed: z.string().nullable(), issued: z.string().nullable(), resolved: z.boolean(), resolution: z.string().nullable() })),
  issuance: z
    .object({
      placementId: uuidSchema,
      applicationId: uuidSchema,
      appliedAt: z.string(),
      appliedByName: z.string().nullable(),
      targetMode: z.enum(["create", "update"]),
      links: z.object({
        clientInstructionId: uuidSchema, opportunityId: uuidSchema, comparisonVersion: z.number().int().nullable(),
        insurerResponseId: uuidSchema, coverConfirmationId: uuidSchema, documentId: uuidSchema, issuedPolicyCheckId: uuidSchema, issuanceRequestId: uuidSchema,
      }),
    })
    .nullable(),
  documents: z.array(z.object({ id: uuidSchema, filename: z.string(), kind: z.string(), extractionState: z.string(), role: z.string(), path: z.string() })),
  timeline: z.array(policyTimelineEventSchema),
  work: z.array(policyWorkSchema),
  related: z.array(policyRelatedSchema),
  actions: z.array(policyActionSchema),
  /** What is not known, in words. Never an empty success where a fact is missing. */
  gaps: z.array(z.string()),
  money: z.object({ statement: z.string() }),
  permissions: z.object({ canStartWork: z.boolean(), canEdit: z.boolean() }),
  preparedActions: z.array(z.object({
    id: uuidSchema, actionType: z.string(), state: z.string(), changes: z.array(z.string()), blockers: z.array(z.string()),
    permitted: z.boolean(), expiresAt: z.string(), receipt: z.object({ message: z.string(), at: z.string() }).nullable(),
  })),
});
export type PolicySpaceResponse = z.infer<typeof policySpaceResponseSchema>;

/** `POST /policies/:id/renewal` — started, or the open one found; never a second. */
export const startRenewalResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().nullable(),
  workItemId: uuidSchema.nullable(),
  receipt: z.string().nullable(),
});
export type StartRenewalResponse = z.infer<typeof startRenewalResponseSchema>;

/**
 * `GET /creation-context` — what a creation form may preselect, read from records the caller can
 * see. A policy or client from another brokerage is simply not found: a URL cannot select it.
 */
export const creationContextSchema = z.object({
  client: z.object({ id: uuidSchema, name: z.string() }),
  policy: z.object({ id: uuidSchema, label: z.string(), insurerName: z.string(), policyNumber: z.string().nullable() }).nullable(),
  period: z.object({ id: uuidSchema, start: z.string(), end: z.string() }).nullable(),
});
export type CreationContext = z.infer<typeof creationContextSchema>;
