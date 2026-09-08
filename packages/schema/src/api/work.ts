import { z } from "zod";
import { ActionVerb } from "../actions.js";
import { DraftRow } from "../draft.js";
import { RunEventRow, RunRow, WorkItemKind, WorkItemRow } from "../work.js";
import { uuidSchema } from "./common.js";

/** `POST /work-items` — Phase 2 creates renewals only. Asking twice reopens the same item. */
export const createWorkItemRequestSchema = z.object({
  kind: WorkItemKind.extract(["renewal"]),
  clientName: z.string().trim().min(1).max(200),
  /** Insurers to request terms from. May be empty; the review run then pauses and asks. */
  insurers: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
});
export type CreateWorkItemRequest = z.infer<typeof createWorkItemRequestSchema>;

export const createWorkItemResponseSchema = z.object({
  item: WorkItemRow,
  /** True when an open item already existed and was returned instead (Part 5.4 invariant 1). */
  reopened: z.boolean(),
});
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
});
export type ActRequest = z.infer<typeof actRequestSchema>;

export const actResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), item: WorkItemRow, run: RunRow.nullable(), draft: DraftRow.nullable() }),
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
export const startRunRequestSchema = z.object({ workItemId: uuidSchema, stepId: z.string().min(1), version: z.number().int() });
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const runEventsResponseSchema = z.object({ run: RunRow, events: z.array(RunEventRow) });

/** Drafts: copied is a fact about the draft, not a send. */
export const markDraftCopiedResponseSchema = z.object({ draft: DraftRow });
