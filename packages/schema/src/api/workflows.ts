import { z } from "zod";
import { uuidSchema } from "./common.js";

/** Durable workflow runs (0062, D-129), as Ask, Work, Activity and the Renewal Space read them. */
export const workflowEvidenceSchema = z.object({ label: z.string(), kind: z.string(), ref: z.string().nullable().optional() });
export const workflowStepSchema = z.object({
  key: z.string(),
  position: z.number().int(),
  label: z.string(),
  state: z.enum(["pending", "running", "done", "waiting", "failed", "skipped"]),
  attempts: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  output: z.record(z.string(), z.unknown()),
  evidence: z.array(workflowEvidenceSchema),
  error: z.string().nullable(),
});
export const workflowCommunicationSchema = z.object({
  id: uuidSchema,
  audience: z.enum(["client", "insurer"]),
  partyName: z.string(),
  toAddress: z.string().nullable(),
  subject: z.string(),
  bodyText: z.string(),
  state: z.enum(["prepared", "approved", "delivered", "sent", "superseded"]),
  quoteRequestId: uuidSchema.nullable(),
  deliveredAt: z.string().nullable(),
  deliveryReference: z.string().nullable(),
});
export const workflowApprovalSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  state: z.enum(["pending", "approved", "rejected", "superseded"]),
  bundle: z.array(z.record(z.string(), z.unknown())),
  bundleSha256: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
});
export const workflowRunSchema = z.object({
  id: uuidSchema,
  workflow: z.literal("renewal"),
  subjectId: uuidSchema,
  workItemId: uuidSchema.nullable(),
  state: z.enum(["running", "waiting_approval", "waiting_party", "exception", "done", "cancelled"]),
  stateLabel: z.string(),
  currentStep: z.string().nullable(),
  exception: z.object({ code: z.string(), message: z.string(), needs: z.string(), stepLabel: z.string().optional() }).nullable(),
  nextRunAt: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  title: z.string(),
  client: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  periodEnd: z.string().nullable(),
  progress: z.object({ done: z.number().int(), steps: z.number().int() }),
});
export const workflowDetailSchema = workflowRunSchema.extend({
  steps: z.array(workflowStepSchema),
  approval: workflowApprovalSchema.nullable(),
  communications: z.array(workflowCommunicationSchema),
  permissions: z.object({ canApprove: z.boolean(), canAct: z.boolean() }),
});
export const workflowListSchema = z.object({ runs: z.array(workflowRunSchema) });
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>;

export const startRenewalRequestSchema = z.object({ policyPeriodId: uuidSchema });
export const decideApprovalRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
  note: z.string().trim().max(1000).optional(),
});
export const recordCommunicationDeliveryRequestSchema = z.object({
  method: z.enum(["own_email", "printed", "portal", "hand_delivered", "phone", "other"]),
  reference: z.string().trim().min(3, "Say what proves it").max(300),
  deliveredAt: z.string().datetime({ offset: true }).optional(),
});
export const workflowActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().nullable(),
  run: workflowDetailSchema.nullable(),
});
export type WorkflowActionResponse = z.infer<typeof workflowActionResponseSchema>;
