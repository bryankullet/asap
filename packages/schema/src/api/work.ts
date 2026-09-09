import { z } from "zod";
import { ActionVerb } from "../actions.js";
import { DraftRow } from "../draft.js";
import { UiIntent } from "../intent.js";
import { RunEventRow, RunRow, WorkItemKind, WorkItemRow } from "../work.js";
import { uuidSchema } from "./common.js";

/**
 * `POST /work-items` — Phase 2 creates renewals only. The client is matched by normalised name
 * or given by id; Ask never creates a client. Asking twice reopens the same item.
 */
export const createWorkItemRequestSchema = z
  .object({
    kind: WorkItemKind.extract(["renewal"]),
    clientName: z.string().trim().min(1).max(200).optional(),
    clientId: uuidSchema.optional(),
    /** Insurers to request terms from. May be empty; the review run then pauses and asks. */
    insurers: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  })
  .refine((v) => v.clientName !== undefined || v.clientId !== undefined, {
    message: "clientName or clientId is required",
    path: ["clientName"],
  });
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
