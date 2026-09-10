import { z } from "zod";
import { ActionVerb } from "../actions.js";
import { ComponentId } from "../intent.js";
import { UiIntentView } from "../intent.js";
import { uuidSchema } from "../api/common.js";

/**
 * The Space plan — the thing the renderer renders (D-059).
 *
 * A plan is a list of blocks drawn from `component_definitions` with their props. Today plans are
 * built deterministically from the shared recipes; when a model sits behind them it returns the
 * same shape and passes the same validator. Either way:
 *
 *   plan → server-side validation against the registry → registry lookup → React render
 *
 * Rules this shape exists to make enforceable (§45 rules 9, 10, 12; D-059):
 *   - `component` must exist in `component_definitions` at `version`. Nothing else renders.
 *   - Every value in `props` is read from a record by id. A business value from model text is a
 *     defect however right it looks, so `facts` names where each one came from.
 *   - `actions` may only carry the finite verbs, on a step that exists, with the guard's own
 *     reason when it is not available. A model cannot invent an action or enable a blocked one.
 *   - Progress, cover and money are never in a plan. They are derived from steps and columns.
 */

/** Space types, one per record kind the recipes cover (prototype `recipe()`, build spec Part 6). */
export const SpaceType = z.enum([
  "renewal",
  "claim",
  "placement",
  "servicing",
  "policy",
  "document",
  "communication",
  "reconciliation",
  "report",
]);
export type SpaceType = z.infer<typeof SpaceType>;

/** Which blocks a question asks for. Same vocabulary as `UiIntent.view`. */
export const SpaceView = UiIntentView;
export type SpaceView = z.infer<typeof SpaceView>;

/** The most blocks any one Space may carry. A plan over the limit is rejected, not truncated. */
export const SPACE_BLOCK_LIMIT = 8;

/** Where a displayed fact came from. A block that must cite something carries at least one. */
export const spaceEvidenceSchema = z.object({
  /** What the evidence supports, in the words on the page. */
  label: z.string().min(1).max(200),
  /** The reference a person recorded: a document name, a message id, a clause. */
  reference: z.string().min(1).max(500),
  recordedBy: z.string().min(1).max(200).nullable(),
  recordedAt: z.string().nullable(),
});
export type SpaceEvidence = z.infer<typeof spaceEvidenceSchema>;

/** An action offered on a block. The verb list is finite and the guard writes the reason. */
export const spaceActionSchema = z.object({
  verb: ActionVerb,
  label: z.string().min(1).max(120),
  /** The step the verb applies to. Must be a step on the record. */
  stepId: z.string().min(1),
  /** Null when available. Otherwise the guard's own words: shown disabled, never hidden (§34). */
  disabledReason: z.string().max(500).nullable(),
});
export type SpaceAction = z.infer<typeof spaceActionSchema>;

export const spaceBlockSchema = z.object({
  component: ComponentId,
  version: z.number().int().min(1),
  /** Validated against the component's stored property schema, not against a type in code. */
  props: z.record(z.string(), z.unknown()),
  evidence: z.array(spaceEvidenceSchema).max(10).default([]),
  actions: z.array(spaceActionSchema).max(6).default([]),
});
export type SpaceBlock = z.infer<typeof spaceBlockSchema>;

export const spacePlanSchema = z.object({
  spaceType: SpaceType,
  view: SpaceView,
  /** The record the Space is about. Must resolve for the caller under RLS. */
  recordId: uuidSchema,
  /** Titled as itself, never as its recipe (ui-contract). */
  title: z.string().min(1).max(300),
  blocks: z.array(spaceBlockSchema).max(SPACE_BLOCK_LIMIT),
  /** How this plan was produced. `recipe` is deterministic; no model is connected yet. */
  source: z.enum(["recipe", "model"]),
  /** Follow-up questions, as words a person would type. Max four (UiIntent). */
  suggestions: z.array(z.string().max(120)).max(4).default([]),
});
export type SpacePlan = z.infer<typeof spacePlanSchema>;

export const spacePlanResponseSchema = z.object({
  plan: spacePlanSchema,
  /** Registry versions the plan was validated against, so a stale renderer can say so. */
  registry: z.array(z.object({ component: ComponentId, version: z.number().int() })),
});
export type SpacePlanResponse = z.infer<typeof spacePlanResponseSchema>;
