import { z } from "zod";
import type { ComponentId } from "../intent.js";

/**
 * Property schemas for the components the first Renewal Space uses.
 *
 * `component_definitions` in the database is authoritative (D-059): the API validates a plan's
 * props against the JSON Schema stored there. These Zod schemas are the same shapes in code, and
 * `component-registry.test.ts` asserts the stored JSON Schema equals `z.toJSONSchema` of the
 * schema below — so the registry and the code cannot drift apart silently.
 *
 * Every property is a value read from a record. None is a sentence a model wrote. Note what is
 * absent and stays absent: no progress, no percentage, no confidence, no cover or money status —
 * those are derived elsewhere and never travel in a plan.
 */

const label = z.string().min(1).max(200);
const line = z.string().min(1).max(500);

/** C-01 The client the Space is about, and the human-work status on it. */
export const clientHeaderProps = z.strictObject({
  clientName: label,
  clientKind: z.enum(["individual", "corporate"]),
  /** The four task words only. Position carries the layer (Part 2.3). */
  taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
  taskParty: z.string().max(200).nullable(),
  taskSince: z.string().nullable(),
  fileStatus: z.enum(["not_started", "incomplete", "in_review", "cleared", "refresh_due"]).nullable(),
});

/** The focus block: the next decision in business words, why, and one action. */
export const renewalReadinessProps = z.strictObject({
  eyebrow: z.literal("Next step"),
  headline: line,
  why: line,
  /** The guard's own words when the step is blocked. Null when it is not. */
  blockedBy: line.nullable(),
  /** What is already done, as facts, never as a percentage. */
  ready: z.array(label).max(12),
  outstanding: z.array(label).max(12),
});

/** The period of cover the renewal is about. */
export const policyCardProps = z.strictObject({
  classOfBusiness: label,
  insurerName: label,
  policyNumber: z.string().max(100).nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Cover words only, on their own line (Part 2.3). */
  coverStatus: z
    .enum(["draft", "requested", "submitted", "confirmed", "active", "expired", "cancelled"])
    .nullable(),
});

/** Who has answered and who has not. The prototype's "Insurer terms" panel. */
export const insurerResponseTrackerProps = z.strictObject({
  insurers: z
    .array(
      z.strictObject({
        name: label,
        /** On file or not. Never "waiting" (ui-contract bans the bare word). */
        state: z.enum(["on_file", "not_on_file", "declined"]),
        /** The reference for what is on file, so the fact is tappable to its source. */
        reference: z.string().max(500).nullable(),
        recordedAt: z.string().nullable(),
      }),
    )
    .max(10),
});

/** Terms side by side. Only when the question asks for a comparison. */
export const termComparisonProps = z.strictObject({
  /** Rows are named facts, one per line, so a difference is visible without a chart. */
  rows: z
    .array(
      z.strictObject({
        fact: label,
        values: z.array(z.strictObject({ insurerName: label, value: line })).max(6),
      }),
    )
    .max(20),
  /** Named, not scored: ASAP does not pick a winner. */
  note: line.nullable(),
});

/** What has been prepared for a person to send. Copying is not sending (Part 7). */
export const draftEmailProps = z.strictObject({
  to: z.string().max(200),
  subject: line,
  body: z.string().min(1).max(8000),
  /** Set only when a person recorded the send with evidence. */
  sentAt: z.string().nullable(),
  sentEvidence: z.string().max(500).nullable(),
});

/** Evidence beside an important fact. */
export const sourceEvidenceProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        label,
        reference: line,
        recordedBy: z.string().max(200).nullable(),
        recordedAt: z.string().nullable(),
      }),
    )
    .max(20),
});

/** What ASAP did, and what a person recorded. Never the only place a decision lives. */
export const activityFeedProps = z.strictObject({
  runs: z
    .array(
      z.strictObject({
        title: label,
        /** Run words only, in the run slot (Part 2.3). */
        status: z.enum(["working", "paused", "finished", "could_not_finish", "stopped"]),
        nextStep: z.string().max(500).nullable(),
        startedAt: z.string(),
        endedAt: z.string().nullable(),
      }),
    )
    .max(20),
  recorded: z
    .array(z.strictObject({ label, reference: line, recordedBy: z.string().max(200).nullable() }))
    .max(20),
});

/** The steps, as supporting context. Ticks are facts, not a progress bar. */
export const checklistProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        label,
        state: z.enum(["todo", "now", "blocked", "done"]),
        actor: z.enum(["asap", "you", "insurer", "client", "bank", "finance", "regulator"]),
        note: z.string().max(500).nullable(),
      }),
    )
    .max(30),
});

/** The components seeded for the first Renewal Space, with their property schemas. */
export const RENEWAL_SPACE_BLOCK_PROPS = {
  ClientHeader: clientHeaderProps,
  RenewalReadiness: renewalReadinessProps,
  PolicyCard: policyCardProps,
  InsurerResponseTracker: insurerResponseTrackerProps,
  TermComparison: termComparisonProps,
  DraftEmail: draftEmailProps,
  SourceEvidence: sourceEvidenceProps,
  ActivityFeed: activityFeedProps,
  Checklist: checklistProps,
} as const satisfies Partial<Record<ComponentId, z.ZodType>>;

export type RenewalSpaceComponent = keyof typeof RENEWAL_SPACE_BLOCK_PROPS;

/** The JSON Schema for one seeded component, as `component_definitions.props_schema` holds it. */
export function propsJsonSchema(component: RenewalSpaceComponent): unknown {
  return z.toJSONSchema(RENEWAL_SPACE_BLOCK_PROPS[component], { target: "draft-2020-12" });
}
