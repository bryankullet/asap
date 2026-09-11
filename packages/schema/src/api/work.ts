import { z } from "zod";
import { ActionVerb } from "../actions.js";
import { DraftRow } from "../draft.js";
import { UiIntent } from "../intent.js";
import { RunEventRow, RunRow, WorkItemKind, WorkItemRow } from "../work.js";
import { uuidSchema } from "./common.js";
import { claimDetailSchema, endorsementDetailSchema } from "./servicing.js";

/**
 * `POST /work-items` — Phase 2 creates renewals only. The client is matched by normalised name
 * or given by id; Ask never creates a client. Asking twice reopens the same item.
 */
export const createWorkItemRequestSchema = z
  .object({
    kind: WorkItemKind.extract(["renewal", "claim", "endorsement"]),
    clientName: z.string().trim().min(1).max(200).optional(),
    clientId: uuidSchema.optional(),
    /** renewal: insurers to request terms from. May be empty; the review run then pauses and asks. */
    insurers: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
    /** claim: the incident as the client reported it. `email` keeps the claim a draft until a person registers it. */
    incidentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    incidentSummary: z.string().trim().min(1).max(4000).optional(),
    source: z.enum(["email", "manual", "ask"]).optional(),
    /** endorsement: the policy (or the client's only policy), the request in its own words, who asked. */
    policyId: uuidSchema.optional(),
    requestText: z.string().trim().min(1).max(4000).optional(),
    requestedBy: z.enum(["policyholder", "other"]).optional(),
    requestedByName: z.string().trim().max(200).optional(),
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.clientName !== undefined || v.clientId !== undefined, {
    message: "clientName or clientId is required",
    path: ["clientName"],
  })
  .refine((v) => v.kind !== "claim" || (v.incidentOn && v.incidentSummary), { message: "a claim needs incidentOn and incidentSummary", path: ["incidentOn"] })
  .refine((v) => v.kind !== "endorsement" || v.requestText, { message: "an endorsement needs requestText", path: ["requestText"] });
export type CreateWorkItemRequest = z.infer<typeof createWorkItemRequestSchema>;

const clientCandidateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: z.enum(["individual", "corporate"]),
});

export const createWorkItemResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("opened"),
    item: WorkItemRow,
    /** True when an open item already existed and was returned instead (Part 5.4 invariant 1). */
    reopened: z.boolean(),
  }),
  /** More than one plausible client: ask which (v1 catalogue Part 1). */
  z.object({
    outcome: z.literal("ambiguous"),
    name: z.string(),
    candidates: z.array(clientCandidateSchema),
  }),
  /** No client: the only action offered is creating one, through the H05 path with duplicate review. */
  z.object({ outcome: z.literal("no_client"), name: z.string(), intent: UiIntent }),
  /** endorsement: the client has several policies — ask which. */
  z.object({
    outcome: z.literal("ambiguous_policy"),
    clientId: uuidSchema,
    candidates: z.array(z.object({ id: uuidSchema, label: z.string() })),
  }),
  /** endorsement: no policy on file for this client. Nothing is created. */
  z.object({ outcome: z.literal("no_policy"), clientId: uuidSchema, intent: UiIntent }),
]);
export type CreateWorkItemResponse = z.infer<typeof createWorkItemResponseSchema>;

/** `POST /work-items/:id/actions` — one verb on one step, with what the verb needs. */
export const actRequestSchema = z.object({
  stepId: z.string().min(1),
  verb: ActionVerb,
  /** Optimistic concurrency: the version the person was looking at. `version_current` compares it. */
  version: z.number().int(),
  /** Evidence reference for record_send / record_evidence / complete. */
  evidence: z.string().trim().max(500).optional(),
  /** Party named when evidence is recorded from an outside party, or when a send goes to one. */
  party: z.string().trim().max(100).optional(),
  /** exception: kind and typed reason; lapse also needs clientToldEvidence. */
  exceptionKind: z.enum(["lapse", "loss", "cancellation", "complaint", "no_bid"]).optional(),
  reason: z.string().trim().max(1000).optional(),
  clientToldEvidence: z.string().trim().max(500).optional(),
  /** draft: who it goes to. */
  to: z.string().trim().max(200).optional(),
  /** record_send: the draft being recorded as sent, and whether the outcome is unknown. */
  draftId: uuidSchema.optional(),
  outcomeUnknown: z.boolean().optional(),
  assigneeId: uuidSchema.optional(),
  /** record_evidence on cover confirmation: the inception date; Confirmed reads as Active cover from then. */
  inceptionAt: z.string().datetime({ offset: true }).optional(),
  /** approve: principal-officer override of client_file_cleared, with a typed reason (audited). */
  override: z.object({ reason: z.string().trim().min(1).max(1000) }).optional(),
  /** claim match step: the policy period the person chose. */
  policyPeriodId: uuidSchema.optional(),
  /** claim response step: a call note can never stand in for the insurer's written response. */
  evidenceKind: z.enum(["document", "call_note"]).optional(),
});
export type ActRequest = z.infer<typeof actRequestSchema>;

export const actResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("applied"),
    item: WorkItemRow,
    run: RunRow.nullable(),
    draft: DraftRow.nullable(),
  }),
  z.object({
    outcome: z.literal("blocked"),
    item: WorkItemRow,
    guard: z.string(),
    /** Plain words: what is missing and what would unblock it (Screen Map v3 Part 7 check 7). */
    reason: z.string(),
  }),
]);
export type ActResponse = z.infer<typeof actResponseSchema>;

export const workItemResponseSchema = z.object({
  item: WorkItemRow,
  runs: z.array(RunRow),
  drafts: z.array(DraftRow),
  claim: z.lazy(() => claimDetailSchema).nullable().default(null),
  endorsement: z.lazy(() => endorsementDetailSchema).nullable().default(null),
});
export type WorkItemResponse = z.infer<typeof workItemResponseSchema>;

/** `POST /runs` starts a run for a step whose action is `prepare`. */
export const startRunRequestSchema = z.object({
  workItemId: uuidSchema,
  stepId: z.string().min(1),
  version: z.number().int(),
});
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const runEventsResponseSchema = z.object({ run: RunRow, events: z.array(RunEventRow) });

/** Drafts: copied is a fact about the draft, not a send. */
export const markDraftCopiedResponseSchema = z.object({ draft: DraftRow });

/**
 * `GET /work-items/:id/history` — the audit history of one record (C05).
 *
 * Screen Map v1 C05: "never rewrite historical outcomes". The rows come from `audit_log`, which
 * has been written since Phase 1 and outlives its brokerage (D-054, ON DELETE RESTRICT). This is
 * the read; there is no write, and there never will be from the browser.
 *
 * A row is shown as it was recorded. Previous and new state are summarised into the fields that
 * changed rather than dumped, and nothing here ever carries a document's contents or a credential
 * (`apps/api/src/audit.ts` refuses to write those in the first place).
 */
export const historyEntrySchema = z.object({
  id: z.string(),
  /** Who: a person, ASAP, an automation, or the platform itself. */
  actorType: z.enum(["user", "ai", "automation", "system"]),
  actorName: z.string().nullable(),
  /** What, in the vocabulary the writer used: "work_item.applied", "External send recorded by human". */
  action: z.string(),
  objectType: z.string(),
  objectId: uuidSchema.nullable(),
  /** Succeeded, failed, or was denied. A denial is history too and is never hidden. */
  result: z.enum(["success", "failure", "denied"]),
  failureReason: z.string().nullable(),
  /** The fields that changed, as "field: before → after". Never the whole row. */
  changed: z.array(z.string()).max(20),
  /** Evidence references recorded with the action, if any. */
  evidence: z.array(z.string()).max(10),
  occurredAt: z.string(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyResponseSchema = z.object({
  recordId: uuidSchema,
  entries: z.array(historyEntrySchema),
  /** Rows the caller can see, and how many came back. */
  visible: z.number().int().min(0),
  returned: z.number().int().min(0),
});
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
