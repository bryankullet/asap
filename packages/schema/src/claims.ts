import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * Claims — UI Build Spec v1 Part 6.6, v1 catalogue S10.
 *  - A claim captured from email is a draft until a person matches it to a policy period.
 *  - Cover on the incident date is a review: "looks right", never "is covered".
 *  - The notification clock runs only with a wording clause (with its page) and a verified start
 *    event; otherwise it reads "clock not started" with the reason. A breach is never asserted.
 *  - A call note is our record of a conversation, never the insurer's words.
 *  - Settlement offered, client accepted and payment received are three facts, never one status.
 */
const isoDate = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClaimStatus = z.enum(["draft", "registered", "closed"]);
export const ClaimSource = z.enum(["email", "manual", "ask"]);
export const ClockStartEvent = z.enum(["incident", "client_aware", "notified_to_us"]);
export const DocumentHolder = z.enum(["client", "insurer", "garage", "police", "assessor", "us"]);

export const ClaimRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  work_item_id: uuidSchema,
  client_id: uuidSchema,
  policy_id: uuidSchema.nullable(),
  policy_period_id: uuidSchema.nullable(),
  status: ClaimStatus,
  source: ClaimSource,
  incident_on: day,
  incident_summary: z.string(),
  reported_on: day.nullable(),
  insurer_reference: z.string().nullable(),
  /** The review's wording, produced by the cover-check run from the policy version on the date. */
  cover_review: z.string().nullable(),
  cover_review_version_id: uuidSchema.nullable(),
  clock_clause_reference: z.string().nullable(),
  clock_clause_page: z.number().int().nullable(),
  clock_clause_days: z.number().int().nullable(),
  clock_start_event: ClockStartEvent.nullable(),
  clock_start_on: day.nullable(),
  clock_start_evidence: z.string().nullable(),
  /** Three separate facts. Never merged. */
  offer_reference: z.string().nullable(),
  offer_recorded_at: isoDate.nullable(),
  acceptance_reference: z.string().nullable(),
  acceptance_recorded_at: isoDate.nullable(),
  payment_reference: z.string().nullable(),
  payment_recorded_at: isoDate.nullable(),
  registered_by: uuidSchema.nullable(),
  registered_at: isoDate.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type ClaimRow = z.infer<typeof ClaimRow>;

export const ClaimDocumentRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  claim_id: uuidSchema,
  label: z.string(),
  holder: DocumentHolder,
  reference: z.string().nullable(),
  requested_at: isoDate.nullable(),
  received_at: isoDate.nullable(),
  created_at: isoDate,
});
export type ClaimDocumentRow = z.infer<typeof ClaimDocumentRow>;

export const ClaimNoteKind = z.enum(["call_note", "note"]);
export const ClaimNoteRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  claim_id: uuidSchema,
  kind: ClaimNoteKind,
  spoke_with: z.string().nullable(),
  body: z.string(),
  noted_by: uuidSchema.nullable(),
  noted_at: isoDate,
});
export type ClaimNoteRow = z.infer<typeof ClaimNoteRow>;

export const HOLDER_LABELS: Readonly<Record<z.infer<typeof DocumentHolder>, string>> = {
  client: "the client",
  insurer: "the insurer",
  garage: "the garage",
  police: "the police",
  assessor: "the assessor",
  us: "us",
};

export type ClockState =
  | { started: true; days: number; startEvent: z.infer<typeof ClockStartEvent>; startOn: string; dueOn: string; dayOf: number; clause: string; page: number }
  | { started: false; reason: string };

/** Derived on read. Elapsed time is not a breach without a verified rule and start event. */
export function clockState(c: Pick<ClaimRow, "clock_clause_reference" | "clock_clause_page" | "clock_clause_days" | "clock_start_event" | "clock_start_on" | "clock_start_evidence">, today: string): ClockState {
  const missing: string[] = [];
  if (!c.clock_clause_reference || c.clock_clause_page === null || c.clock_clause_days === null) missing.push("a wording clause with its page and the number of days");
  if (!c.clock_start_event || !c.clock_start_on || !c.clock_start_evidence) missing.push("a verified start event with its date and evidence");
  if (missing.length > 0) return { started: false, reason: `Clock not started: needs ${missing.join(" and ")}.` };
  const start = new Date(`${c.clock_start_on}T00:00:00Z`);
  const due = new Date(start.getTime() + c.clock_clause_days! * 86_400_000);
  const dayOf = Math.floor((new Date(`${today}T00:00:00Z`).getTime() - start.getTime()) / 86_400_000) + 1;
  return {
    started: true,
    days: c.clock_clause_days!,
    startEvent: c.clock_start_event!,
    startOn: c.clock_start_on!,
    dueOn: due.toISOString().slice(0, 10),
    dayOf,
    clause: c.clock_clause_reference!,
    page: c.clock_clause_page!,
  };
}

/** Words that would turn a review into a liability decision. Tested over cover-check output and UI copy. */
export const CLAIM_BANNED_PHRASES = [/\bis covered\b/i, /\bnot covered\b/i, /\bin breach\b/i, /\bbreached\b/i, /\bis insured\b/i];

/** Phrasing helper: the cover-check run's sentence. */
export function coverReviewSentence(input: { found: boolean; className?: string; insurerName?: string; version?: number; on: string }): string {
  if (!input.found) return `Cover on ${input.on} does not look right: no policy version was effective on that date. A person should check before anything is said to the client.`;
  return `Cover on ${input.on} looks right: ${input.className} with ${input.insurerName}, version ${input.version} was effective. This is a review, not the insurer's decision.`;
}

export const CLAIM_COLUMNS =
  "id, organization_id, work_item_id, client_id, policy_id, policy_period_id, status, source, incident_on, incident_summary, reported_on, insurer_reference, cover_review, cover_review_version_id, clock_clause_reference, clock_clause_page, clock_clause_days, clock_start_event, clock_start_on, clock_start_evidence, offer_reference, offer_recorded_at, acceptance_reference, acceptance_recorded_at, payment_reference, payment_recorded_at, registered_by, registered_at, created_at, updated_at";
export const CLAIM_DOCUMENT_COLUMNS = "id, organization_id, claim_id, label, holder, reference, requested_at, received_at, created_at";
export const CLAIM_NOTE_COLUMNS = "id, organization_id, claim_id, kind, spoke_with, body, noted_by, noted_at";
