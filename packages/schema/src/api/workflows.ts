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
/**
 * The one operational reading of a run (D-131): what ASAP is doing, what it completed, what blocks
 * it, what it needs from a person, who it waits for, when it follows up, and what happens next.
 * Computed on the server from persisted steps; Chat, Space, Work and Today all show this.
 */
export const workflowOperationalSchema = z.object({
  origin: z.enum(["window", "manual"]),
  originLabel: z.string(),
  status: z.string(),
  tone: z.enum(["working", "waiting", "attention", "done"]),
  currentWork: z.object({ title: z.string(), detail: z.string() }),
  completed: z.string(),
  blockers: z.array(z.object({ label: z.string(), blocking: z.boolean(), fix: z.string().nullable() })).max(3),
  moreBlockers: z.number().int(),
  needsFromYou: z.string().nullable(),
  waitingFor: z.object({ party: z.string(), since: z.string().nullable() }).nullable(),
  nextFollowUpAt: z.string().nullable(),
  escalatesAt: z.string().nullable(),
  escalatesTo: z.string().nullable(),
  chasing: z.enum(["not_started", "active", "stopped"]),
  afterYouAct: z.string().nullable(),
  attention: z.boolean(),
  attentionReason: z.string().nullable(),
  primaryAction: z.object({ kind: z.enum(["approve", "record_delivery", "resume", "present", "none"]), label: z.string() }),
  outputs: z.array(z.object({ label: z.string(), state: z.string() })),
  owner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type WorkflowOperational = z.infer<typeof workflowOperationalSchema>;

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
  operational: workflowOperationalSchema,
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
/** "Move the next follow-up to Friday": a date, used once; the schedule resumes after it. */
export const moveFollowUpRequestSchema = z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD") });
/** "Stop chasing this insurer" / "Start chasing again". Escalation still happens. */
export const setChasingRequestSchema = z.object({ stop: z.boolean(), reason: z.string().trim().max(500).optional() });

export const workflowActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().nullable(),
  run: workflowDetailSchema.nullable(),
});
export type WorkflowActionResponse = z.infer<typeof workflowActionResponseSchema>;
