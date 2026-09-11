import { z } from "zod";
import { ClaimDocumentRow, ClaimNoteRow, ClaimRow, ClockStartEvent, DocumentHolder } from "../claims.js";
import { EndorsementItem, EndorsementKind, EndorsementRow, ItemDecision, RequestedBy } from "../endorsements.js";
import { PolicyPeriodRow, PolicyRow, PolicyVersionRow } from "../policies.js";
import { uuidSchema } from "./common.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Claim actions outside the step verbs: the facts a person records about the claim itself. */
export const claimActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_clock"),
    clauseReference: z.string().trim().min(1).max(300),
    clausePage: z.number().int().min(1),
    clauseDays: z.number().int().min(1).max(365),
    startEvent: ClockStartEvent,
    startOn: day,
    startEvidence: z.string().trim().min(1).max(300),
  }),
  z.object({ action: z.literal("add_document"), label: z.string().trim().min(1).max(200), holder: DocumentHolder }),
  z.object({ action: z.literal("receive_document"), documentId: uuidSchema, reference: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("add_call_note"), spokeWith: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("set_insurer_reference"), reference: z.string().trim().min(1).max(100) }),
]);
export type ClaimAction = z.infer<typeof claimActionSchema>;

export const endorsementActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("classify"), kind: EndorsementKind }),
  z.object({
    action: z.literal("set_details"),
    effectiveOn: day.optional(),
    items: z.array(EndorsementItem.omit({ decision: true, note: true })).max(50).optional(),
  }),
  z.object({ action: z.literal("record_instruction"), reference: z.string().trim().min(1).max(300), from: RequestedBy, fromName: z.string().trim().max(200).optional() }),
  z.object({
    action: z.literal("decide_item"),
    itemId: z.string().min(1),
    decision: ItemDecision.exclude(["pending"]),
    note: z.string().trim().max(1000).optional(),
    responseReference: z.string().trim().min(1).max(300),
  }),
]);
export type EndorsementAction = z.infer<typeof endorsementActionSchema>;

export const clockStateSchema = z.union([
  z.object({ started: z.literal(true), days: z.number().int(), startEvent: ClockStartEvent, startOn: day, dueOn: day, dayOf: z.number().int(), clause: z.string(), page: z.number().int() }),
  z.object({ started: z.literal(false), reason: z.string() }),
]);

export const claimDetailSchema = z.object({
  claim: ClaimRow,
  documents: z.array(ClaimDocumentRow),
  notes: z.array(ClaimNoteRow),
  clock: clockStateSchema,
  /** Policy periods of the client's policies, for the match step. Two candidates → the person chooses. */
  candidatePeriods: z.array(z.object({ period: PolicyPeriodRow, policy: PolicyRow, insurerName: z.string() })),
});
export type ClaimDetail = z.infer<typeof claimDetailSchema>;

export const endorsementDetailSchema = z.object({
  endorsement: EndorsementRow,
  policy: PolicyRow,
  versions: z.array(PolicyVersionRow),
  missing: z.array(z.string()),
});
export type EndorsementDetail = z.infer<typeof endorsementDetailSchema>;

export const policyResponseSchema = z.object({
  policy: PolicyRow,
  clientName: z.string(),
  insurerName: z.string(),
  periods: z.array(PolicyPeriodRow),
  versions: z.array(PolicyVersionRow),
});
export type PolicyResponse = z.infer<typeof policyResponseSchema>;

/**
 * `POST /policies` — recording cover the brokerage already places (D-068).
 *
 * A brokerage that signs up today has a book already, and until this existed there was no way to
 * put it in. What it records is what a broker can say without opening a document: who it is for,
 * who carries it, what class, its number if there is one, and the period. Not a premium, not a
 * schedule, not a status — each of those arrives with its own evidence through its own step.
 *
 * The insurer is given by name: a brokerage's first policy is also its first insurer, and making
 * someone create the insurer separately first is a form, not a workflow.
 */
export const createPolicyRequestSchema = z
  .object({
    /** By id, or by name — matched exactly as starting work matches it. One pattern, everywhere. */
    clientId: uuidSchema.optional(),
    clientName: z.string().trim().min(1).max(200).optional(),
    insurerName: z.string().trim().min(1).max(120),
    classOfBusiness: z.string().trim().min(1).max(120),
    policyNumber: z.string().trim().max(120).optional(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.clientId !== undefined || v.clientName !== undefined, {
    message: "Name the client, or give its id",
    path: ["clientName"],
  });
export type CreatePolicyRequest = z.infer<typeof createPolicyRequestSchema>;
export type CreatePolicyInput = z.input<typeof createPolicyRequestSchema>;

export const createPolicyResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("recorded"),
    /** False when this policy was already on file: asking twice records a period, never a twin. */
    created: z.boolean(),
    policy: policyResponseSchema,
  }),
  /** Several clients could be meant. Which one is a question, never a guess. */
  z.object({
    outcome: z.literal("ambiguous"),
    name: z.string(),
    candidates: z.array(
      z.object({ id: uuidSchema, name: z.string(), kind: z.enum(["individual", "corporate"]) }),
    ),
  }),
  /** No such client. Nothing is created: a policy belongs to somebody, and ASAP never invents one. */
  z.object({ outcome: z.literal("no_client"), name: z.string() }),
]);
export type CreatePolicyResponse = z.infer<typeof createPolicyResponseSchema>;
