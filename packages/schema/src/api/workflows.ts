import { z } from "zod";
import { uuidSchema } from "./common.js";

/** Every workflow the engine carries (D-139). The database refuses any other name (0065). */
export const WORKFLOW_NAMES = ["renewal", "quotation", "placement", "issuance", "endorsement", "claim"] as const;
export type WorkflowName = (typeof WORKFLOW_NAMES)[number];
/** How each is named in a sentence: "This quotation is finished." */
export const WORKFLOW_NOUN: Record<WorkflowName, string> = { renewal: "renewal", quotation: "quotation", placement: "placement", issuance: "policy issue", endorsement: "endorsement", claim: "claim" };

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
  paused: z.object({ byName: z.string().nullable(), at: z.string().nullable() }).nullable(),
  escalated: z.boolean(),
  /** What ASAP plans to do on its own, and when (Upcoming). */
  upcoming: z.array(z.object({ kind: z.enum(["follow_up", "escalate", "recheck_delivery", "recheck_approval"]), at: z.string(), label: z.string() })),
  /** Every intervention, available or not; one that is not says why. */
  interventions: z.array(z.object({ key: z.string(), label: z.string(), available: z.boolean(), why: z.string().nullable() })),
});
export type WorkflowOperational = z.infer<typeof workflowOperationalSchema>;

export const workflowRunSchema = z.object({
  id: uuidSchema,
  workflow: z.enum(WORKFLOW_NAMES),
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

export const pauseRunRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const escalateRunRequestSchema = z.object({ reason: z.string().trim().min(3, "Say why it is escalated").max(500) });
export const stopRunRequestSchema = z.object({ reason: z.string().trim().min(3, "Say why ASAP should stop").max(500) });

/** Supervision (D-131): every workflow, grouped and ranked, plus what ASAP plans to do next. */
export const supervisionViewKey = z.enum(["needs_me", "asap_handling", "waiting_on_others", "upcoming", "done"]);
export const supervisionResponseSchema = z.object({
  items: z.array(workflowRunSchema.extend({ views: z.array(supervisionViewKey), priority: z.number(), priorityReason: z.string() })),
  upcoming: z.array(z.object({ runId: uuidSchema, title: z.string(), kind: z.string(), at: z.string(), label: z.string(), paused: z.boolean() })),
  counts: z.record(supervisionViewKey, z.number().int()),
  rules: z.array(z.object({ key: z.string(), summary: z.string(), version: z.number().int().nullable(), setByName: z.string().nullable(), source: z.string() })),
});
export type SupervisionResponse = z.infer<typeof supervisionResponseSchema>;

export const workflowActionResponseSchema = z.object({
  outcome: z.enum(["done", "already", "blocked"]),
  reason: z.string().nullable(),
  run: workflowDetailSchema.nullable(),
});
export type WorkflowActionResponse = z.infer<typeof workflowActionResponseSchema>;
