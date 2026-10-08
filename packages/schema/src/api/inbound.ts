import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * The inbound router (D-144). An email reaches ASAP by a mailbox sync or by a person pasting it or
 * uploading its .eml; either way it is classified (a proposal, by the model through the gateway),
 * matched to the workflow runs that could be waiting for it (deterministic first), and routed only
 * when exactly one run fits and the confidence clears the brokerage's rule. Everything else is one
 * Unsorted Work item for a person.
 */
export const INBOUND_KINDS = [
  "insurer_quote",
  "insurer_decline",
  "insurer_confirmation",
  "policy_document",
  "claim_notice",
  "claim_update",
  "endorsement_request",
  "servicing_request",
  "new_enquiry",
  "other",
] as const;
export const InboundKind = z.enum(INBOUND_KINDS);
export type InboundKind = z.infer<typeof InboundKind>;

/** What each kind means, in the words the classifier is given and a person reads. */
export const INBOUND_KIND_LABELS: Readonly<Record<InboundKind, string>> = {
  insurer_quote: "An insurer's quotation or terms",
  insurer_decline: "An insurer declining to quote or to cover",
  insurer_confirmation: "An insurer confirming cover or an endorsement it was asked for, or querying it",
  policy_document: "An insurer sending an issued policy, schedule or certificate",
  claim_notice: "A client reporting a new loss or incident",
  claim_update: "Anything about a claim already reported: documents, references, assessors, offers",
  endorsement_request: "A client asking to change a policy mid-term",
  servicing_request: "A client asking for a document, a certificate or other servicing",
  new_enquiry: "A client or prospect asking for new cover or a quotation",
  other: "Anything else",
};

/** A pasted email, or the raw text of an uploaded .eml file. */
export const inboundMessageRequestSchema = z.union([
  z.object({
    from: z.string().trim().email().max(320),
    to: z.array(z.string().trim().email().max(320)).max(50).default([]),
    cc: z.array(z.string().trim().email().max(320)).max(50).default([]),
    subject: z.string().trim().max(998).default(""),
    body: z.string().max(200_000),
    receivedAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ eml: z.string().min(20).max(2_000_000) }),
]);
export type InboundMessageRequest = z.infer<typeof inboundMessageRequestSchema>;

export const inboundCandidateSchema = z.object({
  runId: uuidSchema,
  workflow: z.string(),
  party: z.string().nullable(),
  score: z.number(),
  why: z.array(z.string()),
});
export type InboundCandidate = z.infer<typeof inboundCandidateSchema>;

export const inboundMessageResponseSchema = z.object({
  outcome: z.enum(["recorded", "already"]),
  emailMessageId: uuidSchema,
});

/** A person settles an Unsorted email: route it to a live run, or dismiss it. */
export const inboundDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("route"), runId: uuidSchema }),
  z.object({ decision: z.literal("dismiss"), reason: z.string().trim().min(3).max(300) }),
]);
export type InboundDecision = z.infer<typeof inboundDecisionSchema>;

/** The brokerage's rule (D-144): the least confidence at which ASAP routes an email by itself. */
export const inboundAutoRouteRuleSchema = z.object({ threshold: z.number().min(0.5).max(1) });

/** A person records an insurer's verified address, and how they know it is the insurer's (D-145). */
export const insurerContactRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  label: z.string().trim().max(120).optional(),
  source: z.string().trim().min(3, "Say how you know this is the insurer's address").max(300),
});
